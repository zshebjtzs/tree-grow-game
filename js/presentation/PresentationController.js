import { AnimationController } from './AnimationController.js';
export class PresentationController {
    constructor({render=()=>{},animationController=new AnimationController()}={}) {
        this.render=render;this.animations=animationController;this.animationState=null;this.combatState=null;
    }
    playCombat({ event, duration = 760, onComplete = () => {} }) {
        if (!event || !Array.isArray(event.affectedNodes)) throw new TypeError('Combat presentation requires a complete combat event');
        this.cancel();
        this.combatState = { type: 'combat', event, progress: 0 };
        this.animations.play({
            duration,
            onUpdate: progress => { if (this.combatState) { this.combatState.progress = progress; this.render(); } },
            onComplete: () => { this.combatState = null; this.render(); onComplete(); }
        });
    }
    playGrowth({node,parent,duration=280,onComplete=()=>{}}) {
        if(!node||!parent||![node.x,node.y,parent.x,parent.y].every(Number.isFinite))throw new TypeError('Growth animation requires valid node and parent snapshots');
        this.cancel();
        this.animationState={type:'growth',nodeId:node.id,parentId:parent.id,node:{...node},parent:{...parent},progress:0};
        this.animations.play({
            duration,
            onUpdate:progress=>{if(this.animationState){this.animationState.progress=progress;this.render();}},
            onComplete:()=>{this.animationState=null;this.render();onComplete();}
        });
    }
    cancel(){this.animations.cancel();const active=this.animationState!==null||this.combatState!==null;this.animationState=null;this.combatState=null;if(active)this.render();return active;}
    get isRunning(){return this.animations.isRunning;}
}
