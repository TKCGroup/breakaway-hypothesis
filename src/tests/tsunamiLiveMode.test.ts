import {describe,it,expect} from 'vitest';
import {createContext,runInContext} from 'node:vm';
import {earthWatchHtml} from '../earth.js';

function harness(fetcher?: (url:string)=>Promise<any>) {
 const html=earthWatchHtml(),calls:string[]=[];
 const nodes:any={tsunamiStatus:{textContent:'',setAttribute(){}},tsunamiLayer:{},tsunamiParts:{value:'live'},tsunamiControls:{hidden:true}};
 for(const node of Object.values(nodes) as any[])node.addEventListener=(_name:string,fn:any)=>{node.handler=fn;};
 const layer=()=>({items:[] as any[],clearLayers(){this.items=[];}}),live=layer(),history=layer();
 const old={id:5786,year:1930,month:3,day:4,locationName:'MADEIRA ISLAND',latitude:32.617,longitude:-16.967,maxWaterHeight:5};
 const ctx:any=createContext({state:{tsunami:true,tsunamiParts:'live',tsunamiData:{history:[old]},tsunamiLiveFetchedAt:0,tsunamiHistoryFetchedAt:0,tsunamiLiveState:'idle',tsunamiHistoryState:'idle'},Date,Promise,isFinite,Math,Array,Number,String,encodeURIComponent,
  document:{getElementById:(id:string)=>nodes[id]},esc:(x:any)=>String(x),formatNumber:(x:any)=>String(x),tsunamiLiveLayer:live,tsunamiHistoryLayer:history,
  L:{circleMarker:(point:any)=>({bindPopup:(popup:string)=>({addTo:(l:any)=>l.items.push({point,popup})})}),geoJSON:(feature:any)=>({bindPopup:(popup:string)=>({addTo:(l:any)=>l.items.push({feature,popup})})})},
  fetch:async(url:string)=>{calls.push(url);return {ok:true,json:async()=>fetcher?await fetcher(url):url.includes('/tsunamis/events')?{items:url.endsWith('page=1')?[old]:[],totalItems:1}:{features:[]}};}});
 const start=html.indexOf('    var TSUNAMI_HISTORY_URL ='),end=html.indexOf('    // The globe lives in a module script',start);
 runInContext(html.slice(start,end),ctx);
 const listeners=html.indexOf('    document.getElementById("tsunamiLayer").addEventListener');
 runInContext(html.slice(listeners,html.indexOf('    // Any movement',listeners)),ctx);
 return {ctx,calls,nodes,live,history,html};
}
describe('current tsunami toggle versus historical archive',()=>{
 it('never fetches or draws historical Madeira under the default toggle',async()=>{const h=harness();await h.ctx.loadTsunami(false);expect(h.calls).toHaveLength(4);expect(h.calls.some(x=>x.includes('/tsunamis/events'))).toBe(false);expect(h.history.items).toHaveLength(0);expect(h.nodes.tsunamiStatus.textContent).not.toContain('1930');expect(h.nodes.tsunamiStatus.textContent).toContain('Historical records are hidden');expect(h.html).not.toContain('<option value="all">Active warnings and recorded history');});
 it('archive fetch is explicit and clearly labelled, never an inferred current alert',async()=>{const h=harness();h.ctx.state.tsunamiParts='history';await h.ctx.loadTsunami(false);expect(h.calls).toHaveLength(3);expect(h.calls.every(x=>x.includes('/tsunamis/events'))).toBe(true);expect(h.history.items).toHaveLength(1);expect(h.live.items).toHaveLength(0);expect(h.history.items[0].popup).toContain('HISTORICAL RECORD — NOT AN ACTIVE ALERT');expect(h.history.items[0].popup).toContain('1930-3-4');expect(h.nodes.tsunamiStatus.textContent).toContain('not attributed to current earthquakes');});
 it('turning the toggle off and on resets an archive visit to current alerts',async()=>{const h=harness();h.ctx.state.tsunamiParts='history';await h.ctx.loadTsunami(false);h.nodes.tsunamiLayer.handler({target:{checked:false}});expect(h.history.items).toHaveLength(0);h.nodes.tsunamiLayer.handler({target:{checked:true}});await h.ctx.loadTsunami(false);expect(h.ctx.state.tsunamiParts).toBe('live');expect(h.nodes.tsunamiParts.value).toBe('live');expect(h.history.items).toHaveLength(0);});
 it('history markers clear immediately while switching to a slow live request',async()=>{let resolve:any;const pending=new Promise(r=>{resolve=r});const h=harness(url=>url.includes('/tsunamis/events')?Promise.resolve({items:url.endsWith('page=1')?[{year:1930,latitude:32,longitude:-17,maxWaterHeight:5}]:[]}):pending);h.ctx.state.tsunamiParts='history';await h.ctx.loadTsunami(false);expect(h.history.items).toHaveLength(1);h.ctx.state.tsunamiParts='live';const request=h.ctx.loadTsunami(false);expect(h.history.items).toHaveLength(0);resolve({features:[]});await request;expect(h.history.items).toHaveLength(0);});
 it('a late live response cannot overwrite an explicitly selected archive',async()=>{let resolve:any;const pending=new Promise(r=>{resolve=r});const h=harness(url=>url.includes('/tsunamis/events')?Promise.resolve({items:url.endsWith('page=1')?[{year:1930,latitude:32,longitude:-17,maxWaterHeight:5}]:[]}):pending);const live=h.ctx.loadTsunami(false);h.ctx.state.tsunamiParts='history';await h.ctx.loadTsunami(false);resolve({features:[]});await live;expect(h.history.items).toHaveLength(1);expect(h.nodes.tsunamiStatus.textContent).toContain('HISTORICAL ARCHIVE');});
 it('partial or malformed live feed failures are not an all-clear',async()=>{const h=harness(url=>Promise.resolve(url.includes('Tsunami%20Watch')?{}:{features:[]}));await h.ctx.loadTsunami(false);expect(h.nodes.tsunamiStatus.textContent).toContain('coverage is incomplete');expect(h.nodes.tsunamiStatus.textContent).not.toContain('feed answered and it was empty');expect(h.history.items).toHaveLength(0);});
 it('warning polygons cannot coexist with a misleading no-alert sentence',async()=>{const h=harness(url=>Promise.resolve({features:url.includes('MapServer')?[{geometry:{type:'Polygon',coordinates:[]},properties:{event:'Tsunami Warning'}}]:[]}));await h.ctx.loadTsunami(false);expect(h.nodes.tsunamiStatus.textContent).toContain('1 current warning polygon');expect(h.nodes.tsunamiStatus.textContent).not.toContain('No active tsunami');});
 it('expired NWS alerts are not rendered as current',async()=>{const h=harness(url=>Promise.resolve({features:url.includes('Tsunami%20Warning')?[{geometry:{type:'Polygon',coordinates:[]},properties:{expires:'1930-03-04T00:00:00Z'}}]:[]}));await h.ctx.loadTsunami(false);expect(h.live.items).toHaveLength(0);});
});
