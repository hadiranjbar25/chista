import {AbsoluteFill} from 'remotion';

// Static, full-resolution end card using the same wordmark as the film.
export function EndCard(){
  return <AbsoluteFill style={{background:'#f5f2f8',color:'#302a39',fontFamily:'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
    <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse at 50% 40%, #e7dcf180 0%, transparent 60%)'}}/>
    <div style={{position:'relative',display:'flex',flexDirection:'column',alignItems:'center',marginTop:-25}}>
      <div style={{display:'flex',alignItems:'center',gap:24}}>
        <span style={{fontSize:178,lineHeight:1,color:'#9875bc',fontWeight:400,marginTop:7}}>✳</span>
        <span style={{fontSize:160,lineHeight:1.15,letterSpacing:-9,fontWeight:720}}>chista</span>
      </div>
      <div style={{width:58,height:2,background:'#c9b5db',marginTop:54,marginBottom:32}}/>
      <div style={{fontSize:30,letterSpacing:.3,color:'#91819f',fontWeight:400}}>Less guessing. More evidence.</div>
    </div>
  </AbsoluteFill>;
}
