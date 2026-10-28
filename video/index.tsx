import { Composition, registerRoot } from 'remotion';
import { AccessDebugging } from './AccessDebugging';
import { EndCard } from './EndCard';
import { renderDuration, renderFps } from './incident';
const Root = () => (
  <>
    <Composition
      id="ChistaAccessDebugging"
      component={AccessDebugging}
      width={1920}
      height={1080}
      fps={renderFps}
      durationInFrames={renderDuration}
    />
    <Composition
      id="ChistaEndCard"
      component={EndCard}
      width={1920}
      height={1080}
      fps={60}
      durationInFrames={1}
    />
  </>
);
registerRoot(Root);
