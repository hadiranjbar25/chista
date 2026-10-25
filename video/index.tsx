import {Composition,registerRoot} from 'remotion';
import {AccessDebugging} from './AccessDebugging';
import {duration,fps} from './incident';
const Root=()=> <Composition id="ChistaAccessDebugging" component={AccessDebugging} width={1920} height={1080} fps={fps} durationInFrames={duration}/>;
registerRoot(Root);
