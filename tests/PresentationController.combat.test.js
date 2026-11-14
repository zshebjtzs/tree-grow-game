import test from 'node:test';
import assert from 'node:assert/strict';
import {PresentationController} from '../js/presentation/PresentationController.js';
test('combat animation publishes progress and clears state before callback',()=>{let complete;const fake={isRunning:false,play(o){this.isRunning=true;o.onUpdate(.4);complete=()=>{this.isRunning=false;o.onComplete();};},cancel(){this.isRunning=false;}};const c=new PresentationController({animationController:fake});let cleared=false;c.playCombat({event:{affectedNodes:[{id:1}]},onComplete:()=>cleared=c.combatState===null});assert.equal(c.combatState.progress,.4);complete();assert.equal(cleared,true);});
test('cancel clears combat presentation state',()=>{const fake={isRunning:false,play(){this.isRunning=true;},cancel(){this.isRunning=false;}};const c=new PresentationController({animationController:fake});c.playCombat({event:{affectedNodes:[]}});assert.equal(c.cancel(),true);assert.equal(c.combatState,null);});
