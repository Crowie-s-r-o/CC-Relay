// Run with: node node_modules/electron/cli.js scripts/verify-launchpad.cjs [output-directory]
// Isolated synthetic HTTP and WebSocket fixtures. Never attaches to a live Relay server.
const {app, BrowserWindow, nativeTheme} = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../public');
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'relay-launchpad-')));
fs.mkdirSync(out,{recursive:true});
const projectPath='/synthetic/relay';
const now=Date.now();
const date=ago=>new Date(now-ago).toISOString();
const projects=['relay','Atlas','vector-lab','talent-finder','northstar','docs','mobile','knowledge'].map((name,i)=>({id:i+1,name,path:i?'/synthetic/'+name:projectPath,max_codex_instances:5,max_claude_instances:3,max_opencode_instances:1}));
const titles=['Refine the Launchpad workspace and verify each layout','Review the provider connection recovery flow','Add support for the new model catalog','Improve keyboard navigation in task history','Check queue ordering across projects'];
const tasks=titles.map((title,i)=>({id:201-i,title,prompt:title,provider:i===1?'claude':'codex',mode:'execute',repo_path:projectPath,status:i===0?'running':'complete',model:'gpt-6-astra',effort:'high',thread_id:'synthetic-thread-'+i,terminal_lifecycle:'disposable',created_at:date(3600000*(i+1)),started_at:date(3600000*(i+1)),finished_at:i?date(3400000*i):null,result:i?'Verified the change and its focused checks.':null,starred:i===1,input_tokens:870815,output_tokens:6840,conversation_metrics:{token_observed:true,input_tokens:870815,output_tokens:6840,total_tokens:877655},latest_event_id:3}));
const monitorTasks=[tasks[0],...projects.slice(1,6).map((p,i)=>({...tasks[0],id:190-i,repo_path:p.path,title:'Verify the next project milestone'}))];
let prefs=null,interactive=false;const requests=[],errors=[];
function answer(u,method,body) {
 if(u.pathname==='/api/ui-preferences') {if(method==='PATCH')prefs=JSON.parse(body);return {preferences:prefs};}
 if(u.pathname==='/api/status')return {capabilities:{projectLauncher:true,disposableTerminalPools:true,taskFullTextSearch:true,taskStarring:true,taskNaming:true,imageAttachments:true,pushToTalkVoiceInput:true,taskTerminalScreen:true,originalTerminalScreen:true,nativeTerminalScreen:true,planCouncilProviderOrder:true,retainedTerminalSessions:true,planCouncilTerminalExecution:true,turboSingleExecutorPipeline:true},codex:{available:true,authenticated:true},claude:{available:true,authenticated:true},opencode:{available:true,authenticated:true},runningTasks:tasks.length?monitorTasks:[],terminalPool:{repoPath:projectPath,active:{codex:1}},queue:{runningTaskId:tasks.find(t=>t.status==='running')?.id||null,waiting:0},counts:{running:tasks.filter(t=>t.status==='running').length,queued:0,complete:tasks.filter(t=>t.status==='complete').length},paused:false};
 if(u.pathname==='/api/projects')return {projects,activeProjectPath:projects.length?projectPath:null};
 if(u.pathname==='/api/threads')return {threads:[],connection:{connected:true},providers:[]};
 if(u.pathname==='/api/tasks')return {tasks};
 if(/^\/api\/tasks\/\d+$/.test(u.pathname))return {task:tasks.find(t=>t.id===Number(u.pathname.split('/').at(-1))),events:[{id:1,type:'task.started',created_at:date(120000),payload:{}},{id:2,type:'item.completed',created_at:date(100000),payload:{item:{type:'agentMessage',text:'I will check the workspace layout, preserve the queue controls, and verify light and dark themes.'}}},{id:3,type:'item.completed',created_at:date(90000),payload:{item:{type:'commandExecution',command:'npm test',aggregatedOutput:'Focused checks passed.',exitCode:0,status:'completed'}}}],prompts:[]};
 if(u.pathname.endsWith('/terminal-screen') && interactive)return {terminal:{state:'interactive',transport:'pty',launchId:'synthetic-launch',provider:'codex',threadId:'synthetic-thread-0'}};
 if(u.pathname.endsWith('/terminal-screen'))return {terminal:{state:'live',provider:'codex',threadId:'synthetic-thread-0',text:'› codex --model gpt-6-astra --effort high\n\nI will inspect the workspace layout, preserve the queue controls,\nand verify light and dark themes.\n\n$ rg -n "project-dock|task-card" public/\n  public/index.html\n  public/launchpad.css\n\n  Updated composer, queue cards, and activity panel.\n\n$ npm test\n  All focused checks passed.\n\n› Continuing verification...'}};
 if(u.pathname==='/api/models')return {models:[]};
 if(u.pathname==='/api/terminal-displays')return {displays:[{index:0,name:'Primary display',width:1920,height:1080}]};
 if(u.pathname==='/api/plans')return {plans:[]};
 if(u.pathname==='/api/tasks/search')return {tasks:[],matches:[],query:u.searchParams.get('query')};
 if(u.pathname==='/api/projects/1' && method==='PATCH'){const value=JSON.parse(body);for(const [apiKey,field] of [['maxCodexInstances','max_codex_instances'],['maxClaudeInstances','max_claude_instances'],['maxOpenCodeInstances','max_opencode_instances']])if(value[apiKey]!==undefined)projects[0][field]=value[apiKey];return {project:projects[0]};}
 if(u.pathname==='/api/projects/1/settings')return {project:projects[0]};
 return {};
}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost'); 
 if(u.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': fixture\n\n');return;}
 if(u.pathname.startsWith('/api/')){let body='';req.on('data',d=>body+=d);req.on('end',()=>{requests.push([req.method,u.pathname]);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(answer(u,req.method,body)));});return;}
 const vendors={'/vendor/xterm.js':'@xterm/xterm/lib/xterm.js','/vendor/xterm.css':'@xterm/xterm/css/xterm.css','/vendor/addon-fit.js':'@xterm/addon-fit/lib/addon-fit.js'};
 const file=vendors[u.pathname]?path.join(root,'../node_modules',vendors[u.pathname]):path.join(root,u.pathname==='/'?'index.html':u.pathname);
 try{const data=fs.readFileSync(file);res.writeHead(200,{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'",'Content-Type':({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}
});
const {WebSocketServer}=require(path.join(root,'../node_modules/ws'));
const sockets=new WebSocketServer({server});
sockets.on('connection',socket=>socket.send(JSON.stringify({type:'snapshot',cols:100,rows:36,data:'\x1b[32mCC Relay original terminal\x1b[0m\r\n\r\n› Refine the Launchpad workspace and verify each layout\r\n\r\n  Reading public/index.html\r\n  Reading public/launchpad.css\r\n\r\n  Updated the composer, queue and activity panel.\r\n\r\n$ npm test\r\n\x1b[32m  All focused checks passed.\x1b[0m\r\n\r\n› Continuing verification...'})));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let w;
app.whenReady().then(async()=>{
 try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 nativeTheme.themeSource='dark';
 w=new BrowserWindow({show:false,frame:false,width:1720,height:1040,webPreferences:{sandbox:true,partition:'relay-launchpad-qa-'+Date.now()}});
 w.webContents.on('did-start-loading',()=>console.log('Loading'));
 w.webContents.on('dom-ready',()=>console.log('DOM ready'));
 w.webContents.on('did-finish-load',()=>console.log('Loaded'));
 w.webContents.on('console-message',(_e,level,message)=>{if(level>=2){errors.push(message);console.log('Renderer',message);}});
 await w.loadURL('http://127.0.0.1:'+server.address().port+'/');
 await sleep(1200);
 const js=s=>w.webContents.executeJavaScript(s);
 const capture=async name=>{await sleep(150);fs.writeFileSync(out+'/'+name+'.png',(await w.webContents.capturePage()).toPNG());if(!(await js(`document.body.scrollWidth <= innerWidth`)))console.log('Overflow '+name,await js(`JSON.stringify([...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+2&&e.getBoundingClientRect().width>0).slice(0,18).map(e=>({id:e.id,cl:e.className,w:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})))`));assert.ok(await js(`document.body.scrollWidth <= innerWidth`),'No page overflow: '+name);};
 const metrics=()=>js(`JSON.stringify({theme:document.documentElement.dataset.theme,body:[document.body.clientWidth,document.body.scrollWidth],panels:[...document.querySelectorAll('.workspace > .panel')].map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),scroll:[e.clientHeight,e.scrollHeight,e.clientWidth,e.scrollWidth]})),prompt:document.querySelector('#task-prompt').getBoundingClientRect().toJSON(),submit:document.querySelector('#task-submit-button').getBoundingClientRect().toJSON(),errors:document.querySelector('#queue-summary').textContent})`);
 await js(`document.fonts.ready`);await capture('dark-desktop');console.log(await metrics());
 assert.deepEqual(await js(`Array.from(document.querySelectorAll('.workspace > .panel'), e=>e.getBoundingClientRect().width)`),[420,440,860]);
 assert.equal(await js(`document.querySelector('.project-dock').getBoundingClientRect().height`),51);
 assert.equal(await js(`document.querySelector('#task-submit-button').getBoundingClientRect().height`),38);
 assert.equal(await js(`document.querySelector('.header-running-task').getBoundingClientRect().height`),24);
 assert.ok(await js(`Math.abs(document.querySelector('.native-terminal-screen').getBoundingClientRect().top - 251) <= 1`),'Terminal inset matches reference geometry');
 await js(`document.querySelector('#event-more-views').open=true; document.querySelector('[data-event-filter=commands]').click()`);
 assert.equal(await js(`document.querySelector('#event-more-views').open`),false);
 assert.equal(await js(`document.querySelector('#event-more-views summary').textContent`),'Commands');
 await capture('commands');
 await js(`document.querySelector('#original-terminal-view').click()`);
 await js(`const data=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1S8AAAAASUVORK5CYII='),c=>c.charCodeAt(0)); const transfer=new DataTransfer();transfer.items.add(new File([data],'synthetic-reference.png',{type:'image/png'}));document.querySelector('#image-input').files=transfer.files;document.querySelector('#image-input').dispatchEvent(new Event('change',{bubbles:true}));`);await sleep(250);
 assert.equal(await js(`document.querySelectorAll('[data-remove-attachment]').length`),1,'Image picker stages an attachment in the unified toolbar');
 await capture('prompt-image');await js(`document.querySelector('[data-remove-attachment]').click()`);
 assert.equal(await js(`document.querySelectorAll('[data-remove-attachment]').length`),0);
 await js(`document.querySelector('#plan-council-enabled').click()`);await capture('council-dark');
 assert.ok(await js(`Math.abs(document.querySelector('.council-row-labels span:nth-child(3)').getBoundingClientRect().top-document.querySelector('#plan-author-model').closest('label').getBoundingClientRect().top)<1`),'Council model label aligns with both columns');
 await js(`document.querySelector('[data-plan-council-first=codex]').click()`); assert.ok(await js(`document.querySelector('.execute-council-provider-codex').getBoundingClientRect().left < document.querySelector('.execute-council-provider-claude').getBoundingClientRect().left`),'Codex author appears first'); await capture('council-codex-first');await js(`document.querySelector('#mode-turbo').click()`);await capture('turbo-dark');
 assert.equal(await js(`document.querySelector('#turbo-council-review-step').getBoundingClientRect().height`),0,'No reviewer row while council is off');
 await js(`document.querySelector('#turbo-council-enabled').click();document.querySelector('[data-council-first=claude]').click()`);
 assert.ok(await js(`document.querySelector('#turbo-council-review-step').getBoundingClientRect().top < document.querySelector('#turbo-council-codex-step').getBoundingClientRect().top`),'Turbo council order follows the actual author');
 await capture('turbo-council');await js(`document.querySelector('#turbo-council-enabled').click()`);
 await js(`document.querySelector('#mode-execute').click();document.querySelector('#plan-council-enabled').checked && document.querySelector('#plan-council-enabled').click(); document.querySelector('#terminal-settings-button').click()`);await capture('settings-dark'); await js(`document.querySelector('.terminal-settings-body').scrollTop=9999`);await capture('settings-bottom');
 await js(`document.querySelector('#terminal-settings-close').click();document.querySelector('#theme-toggle').click()`);await capture('light-desktop');
 w.setContentSize(1200,900);await capture('light-medium');console.log(await metrics());
 w.setContentSize(480,900);await capture('light-compact');console.log(await metrics());
 await js(`document.querySelector('#theme-toggle').click()`);await capture('dark-compact');
 w.setContentSize(320,900);await capture('dark-mobile');console.log(await metrics());
 // Extra verification pass: real renderer controls, saved preferences, both scroll owners.
 await js(`document.querySelector('.workspace').scrollTop = document.querySelector('.workspace').scrollHeight`);
 await capture('compact-activity');
 assert.ok(await js(`document.querySelector('.detail-panel').getBoundingClientRect().top < document.querySelector('.app-header').getBoundingClientRect().top`),'Compact activity is reachable above monitor');
 w.setContentSize(1720,1040); await sleep(200);
 await js(`document.querySelector('.workspace').scrollTop = 0; document.querySelector('#task-prompt').value = 'Check the saved draft'; document.querySelector('#task-prompt').dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('#provider-claude').click()`);
 assert.equal(await js(`document.querySelector('#task-prompt').value`),'Check the saved draft');
 assert.equal(await js(`document.querySelector('#provider-claude').getAttribute('aria-selected')`),'true');
 const beforePatches=requests.filter(([method,p])=>method==='PATCH'&&p==='/api/projects/1').length;
 await js(`document.querySelector('[data-step-input=max-codex-instances][data-step=\"1\"]').click()`);await sleep(200);
 assert.equal(projects[0].max_codex_instances,6,'Stepper saves the capacity through the original project endpoint');
 assert.equal(requests.filter(([method,p])=>method==='PATCH'&&p==='/api/projects/1').length,beforePatches+1,'One click saves once');
 assert.equal(await js(`document.querySelector('#provider-claude').getAttribute('aria-selected')`),'true','Changing Codex capacity keeps Claude selected');
 await js(`document.querySelector('#max-codex-instances').value='8';document.querySelector('#max-codex-instances').dispatchEvent(new Event('change',{bubbles:true}))`);await sleep(200);
 assert.equal(await js(`document.querySelector('[data-step-input=max-codex-instances][data-step=\"1\"]').disabled`),true,'The plus control stops at 8');
 await js(`document.querySelector('[data-step-input=max-codex-instances][data-step=\"-1\"]').click()`);await sleep(200);
 assert.equal(projects[0].max_codex_instances,7);
 w.webContents.debugger.attach('1.3'); await w.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
 await js(`document.querySelector('#max-codex-instances').focus()`);
 assert.equal(await js(`document.querySelector('#provider-claude').getAttribute('aria-selected')`),'true','Pool focus does not select provider');
 console.log('Focus',await js(`JSON.stringify({id:document.activeElement.id,focused:document.hasFocus(),visible:document.activeElement.matches(':focus-visible'),disabled:document.querySelector('#max-codex-instances').disabled})`)); assert.notEqual(await js(`getComputedStyle(document.activeElement).outlineStyle`),'none');
 await js(`document.querySelector('#provider-codex').click(); document.querySelector('#display-settings').open = true; document.querySelector('#header-position-toggle').click()`);
 assert.equal(await js(`document.documentElement.dataset.headerPosition`),'top');
 const oldTerminalHeight=await js(`document.querySelector('.events-section').getBoundingClientRect().height`);
 await js(`document.querySelector('#terminal-height-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);await sleep(150);
 assert.ok(await js(`document.querySelector('.events-section').getBoundingClientRect().height`) < oldTerminalHeight,'Keyboard terminal resizing changes the actual surface');
 const oldWidth=await js(`document.querySelector('.composer').getBoundingClientRect().width`);
 await js(`document.querySelector('#composer-queue-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
 await sleep(180);
 assert.ok(await js(`document.querySelector('.composer').getBoundingClientRect().width`) > oldWidth,'Keyboard resizing works');
 await js(`document.querySelector('#display-settings').open = false`);
 await capture('saved-top-layout');
 const savedWidth=await js(`document.querySelector('.composer').getBoundingClientRect().width`);
 await w.reload(); await sleep(1500);
 assert.equal(await js(`document.documentElement.dataset.headerPosition`),'top','Saved monitor preference is restored');
 assert.equal(await js(`document.querySelector('.composer').getBoundingClientRect().width`),savedWidth,'Saved width is restored');
 await js(`document.fonts.ready`);
 assert.ok(await js(`document.fonts.check('500 12px "Space Grotesk"') && document.fonts.check('400 12px "IBM Plex Mono"')`),'Reference fonts loaded');
 await js(`document.querySelector('#task-prompt').value = 'Ready for the queue'; document.querySelector('#task-prompt').dispatchEvent(new Event('input',{bubbles:true}))`);
 assert.equal(await js(`document.querySelector('#task-submit-button').disabled`),false,'Direct queue action is usable');
 await capture('final-desktop');
 // Verify compatibility state chrome independently of live terminal discovery.
 await js(`const sample = document.createElement('div'); sample.className = 'terminal-empty'; sample.innerHTML = '<strong>No terminal connected</strong><p>Launch a terminal to continue.</p>'; document.querySelector('#terminal-panel').append(sample);`);
 assert.equal(await js(`getComputedStyle(document.querySelector('.terminal-empty')).backgroundColor`),'rgb(21, 27, 34)','Dark empty-state surface follows the final palette');
 await w.loadURL('http://127.0.0.1:'+server.address().port+'/?desktopTitlebar=hidden-inset-v1');await sleep(1200);await capture('native-desktop');assert.equal(await js(`document.querySelector('#terminal-legend').textContent`),'Automatic terminals','A cached project reload still renders automatic controls');
 assert.equal(await js(`document.documentElement.dataset.desktopTitlebar`),'true');
 interactive=true;await w.reload();await sleep(1400);await js(`document.querySelector('#original-terminal-view').click()`);await sleep(400);await capture('interactive-terminal');
 assert.equal(await js(`document.querySelector('.events-section').dataset.terminalInteractive`),'true');
 assert.equal(await js(`document.querySelector('#terminal-legend').textContent`),'Automatic terminals');
 assert.ok(await js(`document.querySelector('#embedded-terminal').getBoundingClientRect().height > 400`),'Interactive terminal has a usable screen');
 assert.ok(await js(`document.querySelector('#event-metrics').getBoundingClientRect().height > 0`),'Metrics remain visible above the original terminal');
 await js(`document.querySelector('#terminal-window-open').click()`);await sleep(250);await capture('terminal-dialog');
 assert.equal(await js(`document.querySelector('#terminal-window-modal').open`),true);
 w.setContentSize(380,900);await capture('terminal-dialog-compact');
 assert.ok(await js(`document.querySelector('#embedded-terminal').getBoundingClientRect().width <= 380`));
 await js(`document.querySelector('#terminal-window-close').click()`);
 w.setContentSize(1720,1040);
 tasks.splice(0); projects.splice(0); await w.reload(); await sleep(1600); await capture('empty-projects'); assert.doesNotMatch(await js(`document.querySelector('#queue-summary').textContent`), /Cannot read|undefined|TypeError/,'Empty state renders without a fixture error');
 assert.equal(await js(`document.querySelector('#task-submit-button').disabled`),true,'Empty project state fails closed');
 console.log('Extra verification: provider isolation, draft, focus, council order, keyboard resize, persisted monitor/width, font loading, reachable compact activity, and empty project passed.');
 fs.writeFileSync(out+'/result.json',JSON.stringify({requests,errors},null,2));
 console.log('Header styles',await js(`JSON.stringify([...document.querySelectorAll('.app-header,.header-running-monitor,.header-actions,.provider-usage')].map(e=>({cl:e.className,display:getComputedStyle(e).display,wrap:getComputedStyle(e).flexWrap,width:getComputedStyle(e).width,position:getComputedStyle(e).position,flex:getComputedStyle(e).flex,columns:getComputedStyle(e).gridTemplateColumns,height:getComputedStyle(e).height})))`)); console.log('Overflow',await js(`JSON.stringify([...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+2 && e.getBoundingClientRect().width>0 && getComputedStyle(e).position!=='absolute').slice(0,40).map(e=>({id:e.id,cl:e.className,w:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})))`));console.log('Artifacts:',out);console.log('Errors:',JSON.stringify(errors));assert.deepEqual(errors,[],'No renderer warnings or errors');assert.ok(!requests.some(([method,p])=>method==='POST'&&p==='/api/tasks'),'No provider work was launched');
 }catch(e){console.error(e);process.exitCode=1;}finally{if(w&&!w.isDestroyed())w.destroy();for(const socket of sockets.clients)socket.terminate();sockets.close();server.closeAllConnections();server.close(()=>app.quit());}
});
