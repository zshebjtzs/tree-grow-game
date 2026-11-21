export class AnimationController {
    constructor({requestFrame=cb=>globalThis.requestAnimationFrame(cb),cancelFrame=id=>globalThis.cancelAnimationFrame(id)}={}) {
        this.requestFrame=requestFrame; this.cancelFrame=cancelFrame; this.frameId=null; this.active=null; this.speed=1;
    }
    get isRunning(){return this.active!==null;}
    play({duration=250,onUpdate=()=>{},onComplete=()=>{}}={}) {
        if(!Number.isFinite(duration)||duration<0) throw new TypeError('Animation duration must be non-negative');
        this.cancel();
        const task={duration,onUpdate,onComplete,elapsed:0,lastTimestamp:null,speed:this.speed,completed:false};
        this.active=task;
        const tick=timestamp=>{
            if(this.active!==task||task.completed)return;
            if(task.lastTimestamp!==null) task.elapsed+=Math.max(0,timestamp-task.lastTimestamp)*task.speed;
            task.lastTimestamp=timestamp;
            const progress=duration===0?1:Math.min(1,Math.max(0,task.elapsed/duration));
            try{task.onUpdate(progress);}catch(error){this.active=null;this.frameId=null;throw error;}
            if(progress>=1){this.active=null;this.frameId=null;task.completed=true;task.onComplete();}
            else this.frameId=this.requestFrame(tick);
        };
        this.frameId=this.requestFrame(tick);
    }
    setSpeed(speed) {
        if(!Number.isFinite(speed)||speed<=0) throw new RangeError('Animation speed must be positive');
        this.speed=speed;
        if(this.active) this.active.speed=speed;
        return speed;
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
