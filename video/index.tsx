import {Composition,registerRoot} from 'remotion';
import {AccessDebugging} from './AccessDebugging';
import {renderDuration,renderFps} from './incident';
const Root=()=> <Composition id="ChistaAccessDebugging" component={AccessDebugging} width={1920} height={1080} fps={renderFps} durationInFrames={renderDuration}/>;
registerRoot(Root);
