import test from 'node:test';
import assert from 'node:assert/strict';
import {PresentationController} from '../js/presentation/PresentationController.js';
test('growth presentation exposes and clears animation state',()=>{let complete,renders=0;const fake={isRunning:true,play(o){complete=o.onComplete;o.onUpdate(.5);},cancel(){this.isRunning=false;}};const c=new PresentationController({render:()=>renders++,animationController:fake});let done=0;c.playGrowth({node:{id:2,x:20,y:30},parent:{id:1,x:10,y:15},onComplete:()=>done++});assert.equal(c.animationState.progress,.5);complete();assert.equal(c.animationState,null);assert.equal(done,1);assert.equal(renders,2);});
test('cancel clears active presentation state',()=>{const c=new PresentationController({animationController:{isRunning:false,play(){},cancel(){}}});c.animationState={type:'growth'};assert.equal(c.cancel(),true);assert.equal(c.animationState,null);});
