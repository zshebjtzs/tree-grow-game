import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplaySession } from '../js/replay/ReplaySession.js';
import { ReplayController } from '../js/replay/ReplayController.js';
import { createReplayAnimationTimeline } from '../js/replay/ReplayAnimationTimeline.js';
import { ReplayAnimationController } from '../js/replay/ReplayAnimationController.js';
import { AnimationController } from '../js/presentation/AnimationController.js';

const node=(id,owner,parentId,childrenIds=[],areaId=id)=>({id,x:id*10,y:id*12,owner,parentId,childrenIds,isRoot:parentId===null,isDestroyed:false,isFrozen:false,areaId});
const snapshot=nodes=>({gameState:{nodes,currentTurn:'red',nodeIdCounter:Math.max(0,...nodes.map(n=>n.id)),isGameOver:false},matchTracker:{events:[]},lastMatchResult:null});
function sessionFor({beforeNodes,afterNodes,action,events=[]}){
 const before=snapshot(beforeNodes),after=snapshot(afterNodes);after.matchTracker.events=events;
 const history={schemaVersion:1,rulesetVersion:1,historyIncomplete:false,initialSnapshot:before,actions:[{id:1,sequence:1,side:action.owner,action,before,after,completedAt:1}],nextActionId:2};
 return new ReplaySession({schemaVersion:2},{history,validatedHistory:true});
}
function rafHarness(){let id=0;const callbacks=new Map();return{
 requestFrame(cb){const key=++id;callbacks.set(key,cb);return key;},
 cancelFrame(key){callbacks.delete(key);},
 step(timestamp){const batch=[...callbacks.values()];callbacks.clear();batch.forEach(cb=>cb(timestamp));},
 get pending(){return callbacks.size;}
};}
const growthAction={type:'growth',owner:'red',nodeId:2,parentNodeId:1,targetAreaId:2};

test('growth timeline rebuilds the live pre-combat board and shares its 280ms duration',()=>{
 const s=sessionFor({beforeNodes:[node(1,'red',null)],afterNodes:[node(1,'red',null,[2]),node(2,'red',1)],action:growthAction});
 const t=createReplayAnimationTimeline(s,1);
 assert.equal(t.segments.length,1);assert.equal(t.segments[0].type,'growth');
 assert.equal(t.segments[0].duration,280);assert.equal(t.segments[0].animationState.nodeId,2);
 assert.deepEqual(t.segments[0].nodes.find(n=>n.id===1).childrenIds,[2]);
});

test('combat timeline derives removed nodes, attacker, defender, and freeze target from snapshots and events',()=>{
 const s=sessionFor({
  beforeNodes:[node(1,'red',null,[2]),node(2,'red',1,[3]),node(3,'red',2),node(4,'blue',null)],
  afterNodes:[node(1,'red',null),node(4,'blue',null,[5]),node(5,'blue',4)],
  action:{...growthAction,owner:'blue',nodeId:5,parentNodeId:4,targetAreaId:2},
  events:[
   {id:1,type:'COMBAT',side:'blue',attackerNodeId:5,defenderNodeId:2,destroyedNodes:2,freezeTargetId:1},
   {id:2,type:'FREEZE',side:'red',nodeId:1,causedBy:'blue'}
  ]
 });
 const t=createReplayAnimationTimeline(s,1);
 assert.deepEqual(t.segments.map(x=>x.type),['growth','combat']);
 const c=t.segments[1];assert.equal(c.duration,760);
 assert.deepEqual(c.combatState.event.affectedNodes.map(n=>n.id),[2,3]);
 assert.equal(c.combatState.event.attacker.id,5);assert.equal(c.combatState.event.defender.id,2);
 assert.equal(c.combatState.event.freezeTarget.id,1);
});

test('skip actions have no animation segments',()=>{
 const s=sessionFor({beforeNodes:[node(1,'red',null)],afterNodes:[node(1,'red',null)],action:{type:'skip',owner:'red'}});
 assert.deepEqual(createReplayAnimationTimeline(s,1).segments,[]);
});

test('ReplaySession retains combat IDs required by the presentation adapter',()=>{
 const before=snapshot([node(1,'red',null)]),after=snapshot([node(1,'red',null)]);
 after.matchTracker.events=[{id:1,type:'COMBAT',side:'blue',attackerNodeId:9,defenderNodeId:1,freezeTargetId:1,outcome:'branch-cut'}];
 const history={schemaVersion:1,rulesetVersion:1,historyIncomplete:false,initialSnapshot:before,
  actions:[{id:1,sequence:1,side:'blue',action:{type:'growth',owner:'blue',nodeId:9},before,after,completedAt:1}],nextActionId:2};
 const event=new ReplaySession({schemaVersion:2},{history,validatedHistory:true}).getTimelineEntryAt(1).events[0];
 assert.equal(event.attackerNodeId,9);assert.equal(event.defenderNodeId,1);assert.equal(event.freezeTargetId,1);
});

test('ReplayAnimationController drives shared animation frames to completion',async()=>{
 const s=sessionFor({beforeNodes:[node(1,'red',null)],afterNodes:[node(1,'red',null,[2]),node(2,'red',1)],action:growthAction});
 const raf=rafHarness(),frames=[];
 const animationController=new AnimationController({requestFrame:raf.requestFrame,cancelFrame:raf.cancelFrame});
 const c=new ReplayAnimationController({session:s,renderFrame:f=>frames.push(f),animationController});
 const done=c.playStep(1);raf.step(0);raf.step(140);raf.step(280);
 assert.equal(await done,true);assert.equal(frames.at(-1).animationState.progress,1);assert.equal(raf.pending,0);c.destroy();
});

test('cancelling replay animation prevents stale frames',async()=>{
 const s=sessionFor({beforeNodes:[node(1,'red',null)],afterNodes:[node(1,'red',null,[2]),node(2,'red',1)],action:growthAction});
 const raf=rafHarness();let renders=0;
 const c=new ReplayAnimationController({session:s,renderFrame:()=>renders++,animationController:new AnimationController({requestFrame:raf.requestFrame,cancelFrame:raf.cancelFrame})});
 const done=c.playStep(1);assert.equal(c.cancel(),true);assert.equal(await done,false);
 raf.step(500);assert.equal(renders,0);assert.equal(raf.pending,0);
});

test('animated ReplayController commits a step only after its animation completes',async()=>{
 const s=sessionFor({beforeNodes:[node(1,'red',null)],afterNodes:[node(1,'red',null,[2]),node(2,'red',1)],action:growthAction});
 let finish;const scheduled=new Map();let id=0;
 const scheduler={setInterval(){return 1;},clearInterval(){},setTimeout(cb,delay){const key=++id;scheduled.set(key,{cb,delay});return key;},clearTimeout(key){scheduled.delete(key);}};
 const c=new ReplayController(s,{scheduler,animateStep:()=>new Promise(resolve=>finish=resolve)});
 c.play();await Promise.resolve();assert.equal(c.currentStep,0);finish(true);await Promise.resolve();await Promise.resolve();
 assert.equal(c.currentStep,1);assert.equal(c.isPlaying,false);assert.equal(scheduled.size,0);
});

test('natural completion of the final animated step preserves its short audio tail',async()=>{
 const s=sessionFor({beforeNodes:[node(1,'red',null)],afterNodes:[node(1,'red',null,[2]),node(2,'red',1)],action:growthAction});
 let finish,cancelled=0;
 const scheduler={setInterval(){return 1;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){}};
 const c=new ReplayController(s,{scheduler,animateStep:()=>new Promise(resolve=>finish=resolve),cancelAnimation:()=>cancelled++});
 c.play();await Promise.resolve();finish(true);await Promise.resolve();await Promise.resolve();
 assert.equal(c.currentStep,1);
 assert.equal(c.isPlaying,false);
 assert.equal(cancelled,0);
});

test('pausing animated playback cancels its in-flight transition',async()=>{
 const s=sessionFor({beforeNodes:[node(1,'red',null)],afterNodes:[node(1,'red',null,[2]),node(2,'red',1)],action:growthAction});
 let cancelled=0;const scheduler={setInterval(){return 1;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){}};
 const c=new ReplayController(s,{scheduler,animateStep:()=>new Promise(()=>{}),cancelAnimation:()=>cancelled++});
 c.play();c.pause();await Promise.resolve();assert.equal(c.currentStep,0);assert.equal(cancelled,1);assert.equal(c.isPlaying,false);
});


test('replacing an in-flight replay animation invalidates the older transition',async()=>{
 const s=sessionFor({beforeNodes:[node(1,'red',null)],afterNodes:[node(1,'red',null,[2]),node(2,'red',1)],action:growthAction});
 const raf=rafHarness(),frames=[];
 const c=new ReplayAnimationController({session:s,renderFrame:f=>frames.push(f),
  animationController:new AnimationController({requestFrame:raf.requestFrame,cancelFrame:raf.cancelFrame})});
 const older=c.playStep(1);
 const newer=c.playStep(1);
 assert.equal(await older,false);
 assert.equal(raf.pending,1);
 raf.step(0);raf.step(280);
 assert.equal(await newer,true);
 assert.equal(frames.at(-1).animationState.progress,1);
 assert.equal(raf.pending,0);
 c.destroy();
});

test('changing replay speed during an active action updates its clock without scheduling a duplicate action',async()=>{
 const s=sessionFor({beforeNodes:[node(1,'red',null)],afterNodes:[node(1,'red',null,[2]),node(2,'red',1)],action:growthAction});
 let finish,appliedSpeed=null;
 const scheduled=new Map();let id=0;
 const scheduler={setInterval(){return 1;},clearInterval(){},setTimeout(cb,delay){const key=++id;scheduled.set(key,{cb,delay});return key;},clearTimeout(key){scheduled.delete(key);}};
 const c=new ReplayController(s,{scheduler,animateStep:()=>new Promise(resolve=>finish=resolve),setAnimationSpeed:speed=>{appliedSpeed=speed;}});
 c.play();await Promise.resolve();
 assert.equal(scheduled.size,0);
 c.setSpeed(2);
 assert.equal(appliedSpeed,2);
 assert.equal(scheduled.size,0);
 finish(true);await Promise.resolve();await Promise.resolve();
 assert.equal(c.currentStep,1);
 assert.equal(c.isPlaying,false);
 assert.equal(scheduled.size,0);
});
