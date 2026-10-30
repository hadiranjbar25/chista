use super::*;

impl Session {
    // Interrupt inference without destroying the process. Drain the terminal
    // event so no output from the stopped turn can enter the next response.
    pub(super) fn interrupt(&mut self, closed: &AtomicBool) -> Result<String, String> {
        let Some(request) = self.active_request else {
            return Err("Request cancelled.".into());
        };
        let cancelled = AtomicBool::new(false);
        let started = Instant::now();
        let mut total = 0;
        let mut sent = false;
        loop {
            if !sent {
                if let Some(thread) = &self.thread {
                    if let Some(turn) = &self.active_turn {
                        self.pipe.send(json!({"id":format!("interrupt-{request}"),"method":"turn/interrupt","params":{"threadId":thread,"turnId":turn}}))?;
                        sent = true;
                    }
                } else {
                    self.pipe.send(json!({"type":"control_request","request_id":format!("interrupt-{request}"),"request":{"subtype":"interrupt"}}))?;
                    sent = true;
                }
            }
            let event = self.pipe.next_with_timeout(
                &cancelled,
                closed,
                started,
                &mut total,
                Duration::from_secs(10),
            )?;
            if self.thread.is_none() {
                if event["type"] == "result" {
                    self.active_request = None;
                    self.active_turn = None;
                    self.retain_after_error = true;
                    return Err(
                        "Request cancelled. The conversation is ready for your next message."
                            .into(),
                    );
                }
                if event["type"] == "control_request" {
                    let request = &event["request"];
                    let response = match request["subtype"].as_str() {
                        Some("hook_callback") => {
                            let hook = &request["input"]["hook_event_name"];
                            if hook == "PreToolUse" {
                                json!({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"User stopped this turn."}})
                            } else {
                                json!({"continue":false,"stopReason":"User stopped this turn.","hookSpecificOutput":{"hookEventName":hook,"updatedMCPToolOutput":{"content":[{"type":"text","text":"Turn stopped."}]}}})
                            }
                        }
                        Some("mcp_message") => {
                            json!({"mcp_response":{"jsonrpc":"2.0","id":request["message"]["id"],"error":{"code":-32000,"message":"User stopped this turn."}}})
                        }
                        _ => json!({"behavior":"deny","message":"User stopped this turn."}),
                    };
                    self.pipe.send(json!({"type":"control_response","response":{"subtype":"success","request_id":event["request_id"],"response":response}}))?;
                }
                continue;
            }
            if self.pipe.reject_tool(&event)? {
                continue;
            }
            if event["id"].as_u64() == Some(request) && event.get("method").is_none() {
                self.active_turn = event["result"]["turn"]["id"].as_str().map(str::to_string);
                if event.get("error").is_some() {
                    return Err("Turn could not be interrupted safely.".into());
                }
            }
            if event["method"] == "turn/started"
                && event["params"]["threadId"].as_str() == self.thread.as_deref()
            {
                self.active_turn = event["params"]["turn"]["id"].as_str().map(str::to_string);
            }
            if event["method"] == "turn/completed"
                && event["params"]["threadId"].as_str() == self.thread.as_deref()
                && event["params"]["turn"]["id"].as_str() == self.active_turn.as_deref()
                && self.active_turn.is_some()
            {
                self.active_request = None;
                self.active_turn = None;
                self.retain_after_error = true;
                return Err(
                    "Request cancelled. The conversation is ready for your next message.".into(),
                );
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn fixture(agent: &str, scenario: &str) -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let binary = directory.path().join("agent.py");
        let script = r#"#!/usr/bin/env python3
import sys,json
agent=AGENT
scenario=SCENARIO
count=0
first=''
active=''
def emit(v): print(json.dumps(v),flush=True)
for line in sys.stdin:
 f=json.loads(line)
 if agent=='claude':
  if f['type']=='control_request':
   kind=f['request']['subtype']
   emit({'type':'control_response','response':{'subtype':'success','request_id':f['request_id'],'response':{'hooks_applied':True}}})
   if kind=='interrupt': emit({'type':'result','subtype':'error_during_execution','is_error':True,'errors':['Interrupted']})
  elif f['type']=='user':
   count+=1;first=first or f['message']['content']
   if scenario=='closed' and count==1: sys.exit()
   if scenario=='interrupt' and count==1: emit({'type':'stream_event','event':{'delta':{'type':'text_delta','text':'partial'}}})
   elif scenario=='error' and count==1: emit({'type':'result','subtype':'error_during_execution','is_error':True,'errors':['Rate limit']})
   else: emit({'type':'result','subtype':'success','is_error':False,'result':str(count)+':'+first})
 else:
  m=f.get('method')
  if m=='initialize':emit({'id':f['id'],'result':{}})
  elif m=='config/read':emit({'id':f['id'],'result':{'config':{}}})
  elif m=='thread/start':emit({'id':f['id'],'result':{'thread':{'id':'thread'},'model':'fixture-default'}})
  elif m=='turn/start':
   count+=1;first=first or f['params']['input'][0]['text'];active='turn-'+str(count)
   if scenario=='closed' and count==1:sys.exit()
   emit({'id':f['id'],'result':{'turn':{'id':active}}})
   if scenario=='error' and count==1:emit({'method':'turn/completed','params':{'threadId':'thread','turn':{'id':active,'status':'failed'}}})
   else:
    emit({'method':'item/agentMessage/delta','params':{'threadId':'thread','turnId':active,'itemId':'answer','delta':'partial' if count==1 and scenario=='interrupt' else str(count)+':'+first}})
    if scenario!='interrupt' or count!=1:emit({'method':'turn/completed','params':{'threadId':'thread','turn':{'id':active,'status':'completed'}}})
  elif m=='turn/interrupt':
   assert f['params']['threadId']=='thread' and f['params']['turnId']==active
   emit({'id':f['id'],'result':{}})
   emit({'method':'turn/completed','params':{'threadId':'thread','turn':{'id':active,'status':'interrupted'}}})
"#.replace("AGENT", &format!("{agent:?}")).replace("SCENARIO", &format!("{scenario:?}"));
        std::fs::write(&binary, script).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        (directory, binary)
    }
    #[test]
    fn failed_and_interrupted_turns_keep_native_memory_after_a_confirmed_boundary() {
        for agent in ["claude", "codex"] {
            for scenario in ["error", "interrupt", "closed"] {
                let (_directory, binary) = fixture(agent, scenario);
                let cancelled = Arc::new(AtomicBool::new(false));
                let closed = AtomicBool::new(false);
                let mut session =
                    Session::start(binary, agent, "FORMAT", &cancelled, &closed).unwrap();
                let copy = cancelled.clone();
                let channel = Channel::new(move |body| {
                    if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                        let event: Value = serde_json::from_str(&text).unwrap();
                        if event["type"] == "delta"
                            && event["text"] == "partial"
                            && scenario == "interrupt"
                        {
                            copy.store(true, Ordering::SeqCst);
                        }
                    }
                    Ok(())
                });
                assert!(session
                    .turn("first", &channel, &cancelled, &closed)
                    .is_err());
                if scenario == "closed" {
                    assert!(!session.retain_after_error);
                    continue;
                }
                if scenario == "interrupt" {
                    assert!(session.interrupt(&closed).is_err());
                }
                assert!(session.retain_after_error, "{agent} {scenario}");
                assert!(session.active_request.is_none());
                cancelled.store(false, Ordering::SeqCst);
                assert_eq!(
                    session.turn("next", &channel, &cancelled, &closed).unwrap(),
                    "2:first"
                );
            }
        }
    }
}
