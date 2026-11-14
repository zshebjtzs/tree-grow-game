const SIDES=['red','blue'];
const empty=()=>({growthCount:0,attackCount:0,successfulAttackCount:0,destroyedNodes:0,freezeCount:0,rootDestroyedCount:0,maxTreeSize:0,maxBranching:0,maxDepth:0,uniqueAreas:[]});
const copy=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};
export class MatchTracker{
 constructor({startedAt=Date.now(),mode='pvp',difficulty='medium',historyIncomplete=false}={}){
  if(!Number.isFinite(startedAt)||!['pvp','pve'].includes(mode)||!['easy','medium','hard','expert'].includes(difficulty))throw new TypeError('对局统计初始化参数无效');
  this.startedAt=startedAt;this.endedAt=null;this.mode=mode;this.difficulty=difficulty;this.historyIncomplete=!!historyIncomplete;this.totalTurns=0;
  this.players={red:empty(),blue:empty()};this.events=[];this.maxDestructionPerAttack={red:0,blue:0};this.rootCounts={red:0,blue:0};this.finished=false;
 }
 static start(game,config={},options={}){const t=new MatchTracker({...options,mode:config.mode||'pvp',difficulty:config.difficulty||'medium'});t.observe(game);t.rootCounts={red:game.getPlayerRootNodes('red').length,blue:game.getPlayerRootNodes('blue').length};return t;}
 static fromJSON(data){
  try{
   if(!data||data.schemaVersion!==1||!Number.isFinite(data.startedAt)||!['pvp','pve'].includes(data.mode)||!data.players||!Array.isArray(data.events)||!Number.isInteger(data.totalTurns)||data.totalTurns<0)return null;
   const t=new MatchTracker({startedAt:data.startedAt,mode:data.mode,difficulty:data.difficulty,historyIncomplete:data.historyIncomplete});
   for(const side of SIDES){const p=data.players[side];if(!p||!['growthCount','attackCount','successfulAttackCount','destroyedNodes','freezeCount','rootDestroyedCount','maxTreeSize','maxBranching','maxDepth'].every(k=>Number.isInteger(p[k])&&p[k]>=0)||!Array.isArray(p.uniqueAreas))return null;t.players[side]=copy(p);}
   if(data.endedAt!=null&&!Number.isFinite(data.endedAt))return null;
   t.endedAt=data.endedAt??null;t.totalTurns=data.totalTurns;t.events=copy(data.events);
   t.maxDestructionPerAttack=copy(data.maxDestructionPerAttack||{red:0,blue:0});t.rootCounts=copy(data.rootCounts||{red:0,blue:0});t.finished=!!data.finished;return t;
  }catch{return null;}
 }
 observe(game){
  for(const side of SIDES){const nodes=game.getAliveNodesByOwner(side),p=this.players[side],byId=new Map(nodes.map(n=>[n.id,n]));p.maxTreeSize=Math.max(p.maxTreeSize,nodes.length);
   p.maxBranching=Math.max(p.maxBranching,...nodes.map(n=>n.childrenIds.length),0);let depthMax=0;
   for(const node of nodes){let cursor=node,depth=0,seen=new Set();while(cursor&&cursor.parentId!==null&&!seen.has(cursor.id)){seen.add(cursor.id);depth++;cursor=byId.get(cursor.parentId);}depthMax=Math.max(depthMax,depth);}
   p.maxDepth=Math.max(p.maxDepth,depthMax);const areas=new Set(p.uniqueAreas);nodes.forEach(n=>areas.add(n.areaId));p.uniqueAreas=[...areas].sort((a,b)=>a-b);
  }
 }
 push(type,side,details={},at=Date.now()){this.events.push({id:this.events.length+1,type,side,turn:this.totalTurns,at,...copy(details)});}
 recordGrowth(game,node,{isAttack=false,at=Date.now()}={}){if(this.finished||!node||!SIDES.includes(node.owner))return;const p=this.players[node.owner];p.growthCount++;if(isAttack)p.attackCount++;this.totalTurns++;this.push('GROWTH',node.owner,{nodeId:node.id,areaId:node.areaId,isAttack},at);this.observe(game);}
 recordSkip(side){if(!this.finished&&SIDES.includes(side))this.totalTurns++;}
 recordCombat(event,result,at=Date.now()){
  if(this.finished||!event||!result||!SIDES.includes(event.attacker?.owner))return;const side=event.attacker.owner,p=this.players[side],destroyed=[...new Set(result.nodesToDelete||[])].length;
  if(destroyed)p.successfulAttackCount++;p.destroyedNodes+=destroyed;this.maxDestructionPerAttack[side]=Math.max(this.maxDestructionPerAttack[side],destroyed);
  this.push('COMBAT',side,{outcome:event.outcome,attackerNodeId:event.attacker.id,defenderNodeId:event.defender.id,destroyedNodes:destroyed,freezeTargetId:result.freezeTargetId||null},at);
  if(result.freezeTargetId){p.freezeCount++;this.push('FREEZE',side==='red'?'blue':'red',{nodeId:result.freezeTargetId,causedBy:side},at);}
 }
 syncAfterMutation(game,at=Date.now()){
  if(this.finished)return;for(const side of SIDES){const count=game.getPlayerRootNodes(side).length,lost=Math.max(0,this.rootCounts[side]-count);if(lost){this.players[side].rootDestroyedCount+=lost;this.push('ROOT_DESTROYED',side,{count:lost,remaining:count},at);}this.rootCounts[side]=count;}this.observe(game);
 }
 finish(winner,reason,game,at=Date.now()){
  if(this.finished)return this.getResult(game);if(!SIDES.includes(winner)||!['enemy_base_reached','all_roots_destroyed'].includes(reason))throw new TypeError('胜利结果无效');
  this.syncAfterMutation(game,at);this.endedAt=Math.max(at,this.startedAt);this.finished=true;this.push('VICTORY',winner,{reason},this.endedAt);return this.getResult(game);
 }
 getResult(game,at=Date.now()){
  const ended=this.endedAt??Math.max(at,this.startedAt),players=copy(this.players);for(const side of SIDES){players[side].survivingNodes=game.getAliveNodesByOwner(side).length;players[side].survivingRoots=game.getPlayerRootNodes(side).length;players[side].finalOccupiedAreas=[...new Set(game.getAliveNodesByOwner(side).map(n=>n.areaId))].length;players[side].attackConversionRate=players[side].attackCount?players[side].successfulAttackCount/players[side].attackCount:null;}
  const victory=[...this.events].reverse().find(e=>e.type==='VICTORY');
  return freeze({schemaVersion:1,mode:this.mode,difficulty:this.mode==='pve'?this.difficulty:null,startedAt:this.startedAt,endedAt:this.endedAt,durationMs:Math.max(0,ended-this.startedAt),totalTurns:this.totalTurns,winner:victory?.side??null,winReason:victory?.reason??null,historyIncomplete:this.historyIncomplete,players,maxDestructionPerAttack:copy(this.maxDestructionPerAttack),events:copy(this.events)});
 }
 toJSON(){return copy({schemaVersion:1,startedAt:this.startedAt,endedAt:this.endedAt,mode:this.mode,difficulty:this.difficulty,historyIncomplete:this.historyIncomplete,totalTurns:this.totalTurns,players:this.players,events:this.events,maxDestructionPerAttack:this.maxDestructionPerAttack,rootCounts:this.rootCounts,finished:this.finished});}
}