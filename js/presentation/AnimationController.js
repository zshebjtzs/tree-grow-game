export class AnimationController {
    constructor({requestFrame=cb=>globalThis.requestAnimationFrame(cb),cancelFrame=id=>globalThis.cancelAnimationFrame(id)}={}) {
        this.requestFrame=requestFrame; this.cancelFrame=cancelFrame; this.frameId=null; this.active=null;
    }
    get isRunning(){return this.active!==null;}
    play({duration=250,onUpdate=()=>{},onComplete=()=>{}}={}) {
        if(!Number.isFinite(duration)||duration<0) throw new TypeError('Animation duration must be non-negative');
        this.cancel();
        const task={duration,onUpdate,onComplete,startTime:null,completed:false}; this.active=task;
        const tick=timestamp=>{
            if(this.active!==task||task.completed)return;
            if(task.startTime===null)task.startTime=timestamp;
            const progress=duration===0?1:Math.min(1,Math.max(0,(timestamp-task.startTime)/duration));
            try{task.onUpdate(progress);}catch(error){this.active=null;this.frameId=null;throw error;}
            if(progress>=1){this.active=null;this.frameId=null;task.completed=true;task.onComplete();}
            else this.frameId=this.requestFrame(tick);
        };
        this.frameId=this.requestFrame(tick);
    }
    cancel({finish=false}={}) {
        const task=this.active;if(!task)return false;
        if(this.frameId!==null)this.cancelFrame(this.frameId);
        this.frameId=null;this.active=null;
        if(finish&&!task.completed){task.completed=true;task.onUpdate(1);task.onComplete();}
        return true;
    }
    destroy(){this.cancel();}
}
