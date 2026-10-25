import { describe, expect, it, vi } from 'vitest';
import { Sanitizer } from '../safety';
import { endpoint } from './transport';
import { hostedBody, hostedProvider, prepareRequest } from './providers';
describe('outgoing integration boundaries', () => {
  it('allows hosted HTTPS but rejects URL credentials and unsafe schemes', () => {
    expect(endpoint('https://host.example/chat').hostname).toBe('host.example');
    for(const url of ['http://127.0.0.1:3000/chat','file:///etc/passwd','http://remote.example/mcp','https://token@host.example/mcp','https://host.example/mcp?token=secret','https://localhost/chat'])expect(() => endpoint(url)).toThrow();
  });
  it('sends exactly the preview body and no artifact metadata or raw secrets', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'Observed a timeout.'}}]}),{status:200}));
    const config = {endpoint:'https://host.example/chat',model:'hosted-debugger',token:'memory-token'};
    const provider = hostedProvider(config,send);const prepared = prepareRequest([],'Check alex@example.com token=secret123','reviewed sanitized excerpt',new Sanitizer());
    expect(send).not.toHaveBeenCalled();await provider.complete(prepared,new AbortController().signal);
    const body = String(send.mock.calls[0][1]?.body);
    expect(JSON.parse(body)).toEqual(hostedBody(config.model,prepared));expect(body).not.toContain('alex@example.com');expect(body).not.toContain('secret123');expect(body).not.toContain('memory-token');expect(body).not.toContain('projectPath');
  });
  it('surfaces hosted failures without echoing remote response secrets', async () => {
    const provider = hostedProvider({endpoint:'https://host.example/chat',model:'x',token:''},vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive server text',{status:401})));
    await expect(provider.complete({messages:[],context:null},new AbortController().signal)).rejects.toThrow('HTTP 401');
  });
});
