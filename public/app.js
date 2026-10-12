(function(){
"use strict";
const STORE_KEY="smart-scb-demo-events-v2";
const $=function(id){return document.getElementById(id)};
const clamp=function(v,min,max){return Math.max(min,Math.min(max,v))};
const round=function(v,n){const p=Math.pow(10,n||1);return Math.round(v*p)/p};
const types={switch:"Стрелочный электропривод",track:"Рельсовая цепь",signal:"Светофор"};
const devices=[];
for(let i=0;i<8;i++){const n=11+i;devices.push({id:"SW-"+n,type:"switch",name:"Стрелка "+String(n).slice(-2),location:"Электропривод · стрелочный перевод",time:round(3.8+(i%4)*.16,1),current:round(4.35+(i%3)*.12,2),nominalCurrent:4.45,temp:31+(i%4),voltage:24,control:true,cycles:2500+i*620,failures:0,forcedBad:false,position:"Плюсовое",occupied:false,lamp:true})}
for(let i=0;i<6;i++){const n=String(i+1).padStart(2,"0");devices.push({id:"TC-"+n,type:"track",name:"Участок "+n,location:"Рельсовая цепь · контроль занятости",time:0,current:round(.22+(i%3)*.04,2),nominalCurrent:.25,temp:29+(i%3),voltage:round(2.8+(i%3)*.1,1),control:true,cycles:1000+i*350,failures:0,forcedBad:false,position:"—",occupied:false,lamp:true})}
for(let i=0;i<6;i++){const n=String(i+1).padStart(2,"0");devices.push({id:"SG-"+n,type:"signal",name:"Светофор "+n,location:"Светофор · сигнальная лампа",time:0,current:round(.42+(i%3)*.03,2),nominalCurrent:.45,temp:30+(i%4),voltage:round(24+(i%3),1),control:true,cycles:1800+i*400,failures:0,forcedBad:false,position:"Красный",occupied:false,lamp:true})}
let selectedId="SW-17",simMinutes=0,running=false,degradation=false,timer=null,events=[],tickets=[],toastTimer=null,backendAvailable=false;
let history={};
function device(id){return devices.find(function(d){return d.id===id})}
function loadLocalEvents(){try{const a=JSON.parse(localStorage.getItem(STORE_KEY)||"[]");return Array.isArray(a)?a.slice(0,100):[]}catch(e){return[]}}
function saveEvents(){try{localStorage.setItem(STORE_KEY,JSON.stringify(events.slice(0,100)))}catch(e){}}
async function api(path,options){
 const response=await fetch(path,Object.assign({headers:{"Content-Type":"application/json"}},options||{}));
 const data=await response.json().catch(function(){return{}});
 if(!response.ok)throw new Error(data.error||("HTTP "+response.status));
 return data
}
function markBackendUnavailable(){
 backendAvailable=false;
 if($("systemSub"))$("systemSub").textContent="Сервер недоступен · запустите server.py"
}
function serializeDevice(d){
 return{id:d.id,type:d.type,name:d.name,switch_time:d.type==="switch"?d.time:null,current:d.current,nominal_current:d.nominalCurrent,temperature:d.temp,voltage:d.voltage,control:d.control,cycles:d.cycles,failures:d.failures,forced_bad:d.forcedBad,position:d.position,occupied:d.occupied,lamp:d.lamp}
}
function persistDevices(){
 return api("/api/devices",{method:"POST",body:JSON.stringify({devices:devices.map(serializeDevice)})}).then(function(){backendAvailable=true}).catch(function(error){markBackendUnavailable();throw error})
}
function applyDeviceRows(rows){
 rows.forEach(function(row){
  const d=device(row.id);if(!d)return;
  d.type=row.type;d.name=row.name;
  if(row.switch_time!==null)d.time=Number(row.switch_time);
  d.current=Number(row.current);d.nominalCurrent=Number(row.nominal_current);d.temp=Number(row.temperature);d.voltage=Number(row.voltage);
  d.control=Boolean(row.control);d.cycles=Number(row.cycles);d.failures=Number(row.failures);d.forcedBad=Boolean(row.forced_bad);
  d.position=row.position;d.occupied=Boolean(row.occupied);d.lamp=Boolean(row.lamp);updateHealth(d)
 })
}
async function reloadDevicesFromDatabase(showMessage){
 try{
  const result=await api("/api/devices"),rows=result.devices||[];
  if(rows.length){applyDeviceRows(rows)}else{await persistDevices()}
  backendAvailable=true;renderAll();loadTelemetry(selectedId);
  if(showMessage)toast(rows.length?"Параметры загружены из SQLite":"Начальные параметры записаны в SQLite")
 }catch(error){
  markBackendUnavailable();if(showMessage)toast("Не удалось прочитать базу данных")
 }
}
async function loadServerState(){
 try{
  const result=await Promise.all([api("/api/events?limit=100"),api("/api/tickets"),api("/api/devices")]);
  events=(result[0].events||[]).map(function(e){return{time:e.model_time,device:e.device_id,message:e.message,level:e.level}});
  tickets=(result[1].tickets||[]).map(function(t){return{id:t.id,device:t.device_id,priority:t.priority,created:t.created_model_time,reason:t.reason,state:t.state}});
  const rows=result[2].devices||[];
  if(rows.length){applyDeviceRows(rows)}else{await persistDevices()}
  backendAvailable=true;saveEvents();renderAll();renderLog();renderQueue();loadTelemetry(selectedId)
 }catch(error){
  events=loadLocalEvents();markBackendUnavailable();renderLog();renderSystem()
 }
}
function persistTelemetry(){
 const samples=devices.map(function(d){return{model_time:stamp(),device_id:d.id,health:d.health,switch_time:d.type==="switch"?d.time:null,current:d.current,temperature:d.temp,voltage:d.voltage,status:d.status}});
 api("/api/telemetry",{method:"POST",body:JSON.stringify({samples:samples})}).catch(markBackendUnavailable)
}
async function loadTelemetry(id){
 try{
  const result=await api("/api/telemetry?device_id="+encodeURIComponent(id)+"&limit=72");
  const key=$("chartMetric").value,map={health:"health",time:"switch_time",current:"current",temp:"temperature",voltage:"voltage"},rows=result.telemetry||[];
  if(rows.length){history[id]=rows.map(function(row){const value=row[map[key]];return value==null?row.health:Number(value)})}
  backendAvailable=true;drawChart()
 }catch(error){markBackendUnavailable()}
}
function stamp(){const h=Math.floor(simMinutes/60)%24,m=simMinutes%60,day=Math.floor(simMinutes/1440)+1;return "Д"+day+" "+String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")}
function clockText(){const h=Math.floor(simMinutes/60)%24,m=simMinutes%60,day=Math.floor(simMinutes/1440)+1;return "День "+day+" · "+String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")}
function addEvent(id,message,level){
 const entry={time:stamp(),device:id,message:message,level:level||"info"};
 events.unshift(entry);events=events.slice(0,100);saveEvents();renderLog();
 api("/api/events",{method:"POST",body:JSON.stringify({model_time:entry.time,device_id:entry.device,message:entry.message,level:entry.level})}).then(function(){backendAvailable=true}).catch(markBackendUnavailable)
}
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.classList.remove("show")},2400)}
function penalty(v){return clamp(v,0,100)}
function updateHealth(d){
 let pTime=d.type==="switch"?penalty((d.time-4.5)/3.4*100):0;
 let pTemp=penalty((d.temp-42)/35*100);
 let pCurrent=penalty(Math.abs(d.current-d.nominalCurrent)/Math.max(.1,d.nominalCurrent)*180);
 let pFail=penalty(d.failures*28);
 let pCycles=penalty(d.cycles/30000*100);
 d.health=round(clamp(100-(.30*pTime+.20*pTemp+.25*pCurrent+.15*pFail+.10*pCycles),0,100),1);
 d.status=d.forcedBad?"bad":d.health<60?"bad":d.health<80?"warn":"good";
}
function readMetric(d,key){if(key==="health")return d.health;if(key==="time")return d.type==="switch"?d.time:null;if(key==="current")return d.current;if(key==="temp")return d.temp;if(key==="voltage")return d.voltage;return d.health}
function metricValue(d,key){const v=readMetric(d,key);return v===null?d.health:v}
function formatValue(d,key){if(key==="health")return d.health.toFixed(1);if(key==="time")return d.type==="switch"?d.time.toFixed(1)+" с":"—";if(key==="current")return d.current.toFixed(2)+" А";if(key==="temp")return Math.round(d.temp)+" °C";if(key==="voltage")return d.voltage.toFixed(1)+" В";return ""}
const metricNames={health:"индекс состояния",time:"время перевода, с",current:"ток, А",temp:"температура, °C",voltage:"напряжение, В"};
devices.forEach(function(d){updateHealth(d);history[d.id]=Array.from({length:72},function(_,i){return metricValue(d,"health")})});
function getPosition(d){const i=Number(d.id.slice(3));if(d.type==="switch")return{x:230+(i-11)*70,y:(i%2?112:178)};if(d.type==="track")return{x:100+(i-1)*150,y:248};return{x:170+(i-1)*125,y:72}}
function buildMap(){
 let svg=$("stationMap"),s='<text x="25" y="45" class="map-label">СЕВЕРНЫЙ ПУТЬ</text><text x="25" y="145" class="map-label">ГЛАВНЫЙ ПУТЬ</text><text x="25" y="242" class="map-label">ЮЖНЫЙ ПУТЬ</text><g class="track"><path d="M20 62 H960 M20 75 H960 M20 158 H960 M20 171 H960 M20 254 H960 M20 267 H960"/><path class="siding" d="M190 75 L270 158 M190 62 L270 145 M470 171 L550 75 M610 171 L700 254 M330 171 L390 254 M710 158 L785 75"/></g>';
 devices.filter(function(d){return d.type==="track"}).forEach(function(d){let p=getPosition(d);s+='<line id="seg-'+d.id+'" class="track-seg" x1="'+(p.x-40)+'" y1="'+(p.y-8)+'" x2="'+(p.x+40)+'" y2="'+(p.y-8)+'"/>'});
 devices.forEach(function(d){let p=getPosition(d),label=d.id;s+='<g class="map-device" id="map-'+d.id+'" data-device="'+d.id+'" tabindex="0" role="button" aria-label="Выбрать '+d.id+'"><circle class="node-circle" cx="'+p.x+'" cy="'+p.y+'" r="'+(d.type==="track"?12:11)+'"/><text class="node-text" x="'+p.x+'" y="'+p.y+'">'+(d.type==="switch"?"↗":d.type==="track"?"РЦ":"С")+'</text><text class="node-label" x="'+p.x+'" y="'+(p.y+(d.type==="track"?25:-16))+'">'+label+'</text></g>'});
 devices.filter(function(d){return d.type==="signal"}).forEach(function(d){let p=getPosition(d);s+='<line class="signal-pole" x1="'+p.x+'" y1="'+(p.y-7)+'" x2="'+p.x+'" y2="'+(p.y-29)+'"/><circle class="signal-lamp" id="lamp-'+d.id+'" cx="'+p.x+'" cy="'+(p.y-34)+'" r="5"/>'});
 svg.innerHTML=s;
 svg.addEventListener("click",function(e){let n=e.target.closest("[data-device]");if(n)selectDevice(n.getAttribute("data-device"))});
 svg.addEventListener("keydown",function(e){if((e.key==="Enter"||e.key===" ")&&e.target.matches("[data-device]")){e.preventDefault();selectDevice(e.target.getAttribute("data-device"))}});
}
function statusLabel(d){if(d.status==="bad")return "КРИТИЧНО";if(d.status==="warn")return "ВНИМАНИЕ";return d.type==="track"&&d.occupied?"ЗАНЯТ":"НОРМА"}
function cardMetric(d){if(d.type==="switch")return ["Перевод",d.time.toFixed(1)+" с"];if(d.type==="track")return ["Состояние",d.occupied?"Занят":"Свободен"];return ["Лампа",d.lamp?d.position:"Не горит"]}
function renderCards(){
 const grid=$("deviceGrid");grid.innerHTML="";
 devices.forEach(function(d){let item=document.createElement("article");item.className="device-card "+d.status+(d.id===selectedId?" selected":"");item.setAttribute("data-device",d.id);item.setAttribute("tabindex","0");let m=cardMetric(d);
 item.innerHTML='<div class="card-top"><span class="dev-id">'+d.id+'</span><span class="pill '+d.status+'">'+statusLabel(d)+'</span></div><h3>'+d.name+'</h3><div class="card-sub">'+(d.type==="switch"?"Стрелочный перевод":d.type==="track"?"Рельсовая цепь":"Светофор")+'</div><div class="card-metric"><span>'+m[0]+'</span><strong>'+m[1]+'</strong></div><div class="mini-bar"><i style="width:'+d.health+'%"></i></div>';
 grid.appendChild(item)});
}
function selectDevice(id){if(!device(id))return;selectedId=id;renderCards();renderMap();renderDetail();drawChart();loadTelemetry(id)}
function renderMap(){devices.forEach(function(d){let el=$("map-"+d.id);if(!el)return;el.setAttribute("class","map-device "+d.status+(d.id===selectedId?" selected":""));let seg=$("seg-"+d.id);if(seg)seg.setAttribute("class","track-seg"+(d.occupied?" occupied":""));let lamp=$("lamp-"+d.id);if(lamp)lamp.setAttribute("class","signal-lamp"+(!d.lamp?" redlamp":""))})}
function renderDetail(){
 const d=device(selectedId),box=$("detailPanel"),unit=d.type==="switch"?"Электропривод":d.type==="track"?"Контроль занятости":"Светофор";
 let metrics='<div class="metric-list"><div class="metric-box"><span>Индекс состояния</span><strong id="detailHealth">'+d.health.toFixed(1)+'/100</strong></div><div class="metric-box"><span>Статус объекта</span><strong id="detailStatus">'+statusLabel(d)+'</strong></div><div class="metric-box"><span>Ток</span><strong id="detailCurrent">'+d.current.toFixed(2)+' А</strong></div><div class="metric-box"><span>Температура</span><strong id="detailTemp">'+Math.round(d.temp)+' °C</strong></div></div>';
 let fields='';
 if(d.type==="switch"){
 fields='<label class="field">Время перевода, с<input name="time" type="number" min="2" max="15" step="0.1" value="'+d.time.toFixed(1)+'"></label><label class="field">Ток привода, А<input name="current" type="number" min="0" max="15" step="0.1" value="'+d.current.toFixed(2)+'"></label><label class="field">Температура, °C<input name="temp" type="number" min="-20" max="120" step="1" value="'+Math.round(d.temp)+'"></label><label class="field">Напряжение, В<input name="voltage" type="number" min="0" max="40" step="0.1" value="'+d.voltage.toFixed(1)+'"></label><label class="field">Положение стрелки<select name="position"><option '+(d.position==="Плюсовое"?"selected":"")+' value="Плюсовое">Плюсовое</option><option '+(d.position==="Минусовое"?"selected":"")+' value="Минусовое">Минусовое</option></select></label><label class="check-field"><input type="checkbox" name="control" '+(d.control?"checked":"")+'> Контроль положения есть</label>';
 }else if(d.type==="track"){
 fields='<label class="field">Напряжение, В<input name="voltage" type="number" min="0" max="12" step="0.1" value="'+d.voltage.toFixed(1)+'"></label><label class="field">Ток, А<input name="current" type="number" min="0" max="5" step="0.01" value="'+d.current.toFixed(2)+'"></label><label class="field">Температура, °C<input name="temp" type="number" min="-20" max="120" step="1" value="'+Math.round(d.temp)+'"></label><label class="check-field"><input type="checkbox" name="occupied" '+(d.occupied?"checked":"")+'> Участок занят</label>';
 }else{
 fields='<label class="field">Напряжение, В<input name="voltage" type="number" min="0" max="40" step="0.1" value="'+d.voltage.toFixed(1)+'"></label><label class="field">Ток лампы, А<input name="current" type="number" min="0" max="5" step="0.01" value="'+d.current.toFixed(2)+'"></label><label class="field">Температура, °C<input name="temp" type="number" min="-20" max="120" step="1" value="'+Math.round(d.temp)+'"></label><label class="field">Показание<select name="position"><option '+(d.position==="Красный"?"selected":"")+' value="Красный">Красный</option><option '+(d.position==="Жёлтый"?"selected":"")+' value="Жёлтый">Жёлтый</option><option '+(d.position==="Зелёный"?"selected":"")+' value="Зелёный">Зелёный</option></select></label><label class="check-field"><input type="checkbox" name="lamp" '+(d.lamp?"checked":"")+'> Лампа исправна</label>';
 }
 box.innerHTML='<div class="detail-top"><div class="detail-title"><span class="section-tag">'+d.id+' / '+unit.toUpperCase()+'</span><h3>'+d.name+'</h3><p>'+d.location+'</p></div><div class="health-wrap"><div class="health-num '+d.status+'" id="healthNum">'+d.health.toFixed(1)+'</div><div class="health-caption">индекс / 100</div></div></div><div class="health-bar"><i class="'+d.status+'" id="healthBar" style="width:'+d.health+'%"></i></div>'+metrics+'<div class="form-title">ЗАДАТЬ ТЕЛЕМЕТРИЮ · УЧЕБНЫЕ ЗНАЧЕНИЯ</div><form id="detailForm"><div class="edit-grid">'+fields+'</div><div class="apply-row"><button class="btn primary" type="submit">Применить значения</button><button class="btn" type="button" id="ticketFromDetail">Создать заявку</button></div></form><p class="small-copy">Изменения влияют только на отображение и расчёт учебного индекса. Команды реальным устройствам не отправляются.</p>';
 $("detailForm").addEventListener("submit",applyForm);$("ticketFromDetail").addEventListener("click",createTicket)
}
function updateDetailLive(){const d=device(selectedId);if(!$("detailHealth"))return;$("detailHealth").textContent=d.health.toFixed(1)+"/100";$("detailStatus").textContent=statusLabel(d);$("detailCurrent").textContent=d.current.toFixed(2)+" А";$("detailTemp").textContent=Math.round(d.temp)+" °C";$("healthNum").textContent=d.health.toFixed(1);$("healthNum").className="health-num "+d.status;$("healthBar").style.width=d.health+"%";$("healthBar").className=d.status}
function applyForm(e){
 e.preventDefault();const d=device(selectedId),form=e.currentTarget;
 function val(name,old,min,max){const el=form.elements[name];if(!el)return old;const x=Number(el.value);return Number.isFinite(x)?clamp(x,min,max):old}
 d.current=round(val("current",d.current,0,40),2);d.temp=round(val("temp",d.temp,-30,150),1);d.voltage=round(val("voltage",d.voltage,0,50),1);
 if(d.type==="switch"){d.time=round(val("time",d.time,0,20),1);d.position=form.elements.position.value;d.control=form.elements.control.checked;if(d.control)d.forcedBad=false}
 if(d.type==="track")d.occupied=form.elements.occupied.checked;
 if(d.type==="signal"){d.position=form.elements.position.value;d.lamp=form.elements.lamp.checked;if(d.lamp)d.forcedBad=false}
 if((d.type==="switch"&&!d.control)||(d.type==="signal"&&!d.lamp)){d.forcedBad=true;d.failures++}else if(d.type==="signal"&&d.current<.1){d.forcedBad=true;d.failures++}
 updateHealth(d);persistTelemetry();persistDevices().catch(function(){});addEvent(d.id,"Телеметрия изменена вручную · индекс "+d.health.toFixed(1),d.status==="bad"?"bad":d.status==="warn"?"warn":"info");
 setDiagnosticFromDevice(d);renderAll();toast("Показания "+d.id+" обновлены")
}
function setDiagnostic(level,heading,message,recommendation){
 let box=$("diagnosticBox");box.className="diagnostic"+(level==="good"?"":" "+level);$("diagnosticDot").className="dot "+level;$("diagnosticHeading").textContent=heading;$("diagnosticMessage").textContent=message;$("recommendationText").textContent=recommendation
}
function setDiagnosticFromDevice(d){
 if(d.status==="bad")setDiagnostic("bad","Диагностика: критическое состояние · "+d.id,"Индекс "+d.health.toFixed(1)+"/100 или потерян контроль/лампа. Показание требует внимания в рамках учебного сценария.","Зафиксируйте заявку на диагностику; сверяйте выводы с действующими инструкциями специалиста.");
 else if(d.status==="warn")setDiagnostic("warn","Диагностика: обнаружено отклонение · "+d.id,"Индекс "+d.health.toFixed(1)+"/100. Тренд параметров указывает на возможное ухудшение состояния.","Сравните тренд времени, тока и температуры; рассмотрите плановую проверку.");
 else setDiagnostic("good","Диагностика: объект в норме · "+d.id,"Отклонений по условным измерениям не обнаружено.","Продолжайте наблюдение за телеметрией.")
}
function renderSystem(){
 let avg=devices.reduce(function(a,d){return a+d.health},0)/devices.length,att=devices.filter(function(d){return d.status!=="good"}).length,bad=devices.filter(function(d){return d.status==="bad"}).length;
 $("healthKpi").textContent=avg.toFixed(1);$("healthKpi").className="kpi-value "+(avg<60?"bad":avg<80?"warn":"good");$("attentionKpi").textContent=att;$("attentionKpi").className="kpi-value "+(bad?"bad":att?"warn":"good");$("attentionFoot").textContent=bad?bad+" критично · "+(att-bad)+" предупреждений":att+" предупреждений";
 $("ticketsKpi").textContent=tickets.filter(function(t){return t.state==="Открыта"}).length;$("historyKpi").innerHTML="72 <small>ч</small>";
 let status=bad?"bad":att?"warn":"good";$("systemDot").className="dot "+status;$("systemStatus").textContent=bad?"ОБНАРУЖЕНО КРИТИЧЕСКОЕ СОСТОЯНИЕ":att?"ЕСТЬ ПРЕДУПРЕЖДЕНИЯ":"СИСТЕМА В НОРМЕ";$("systemSub").textContent=devices.length+" объектов · "+(running?"симуляция запущена":"симуляция остановлена")+" · "+(backendAvailable?"SQLite подключена":"локальный режим");$("modelClock").textContent=clockText()
}
function renderLog(){
 const body=$("logBody");body.textContent="";
 if(!events.length){let tr=document.createElement("tr");tr.className="empty-row";let td=document.createElement("td");td.colSpan=4;td.textContent="Событий пока нет. Запустите сценарий или задайте телеметрию.";tr.appendChild(td);body.appendChild(tr);return}
 events.slice(0,40).forEach(function(e){let tr=document.createElement("tr");[e.time,e.device,e.message].forEach(function(v){let td=document.createElement("td");td.textContent=v;tr.appendChild(td)});let td=document.createElement("td"),badge=document.createElement("span");badge.className="level "+(e.level||"info");badge.textContent=e.level==="bad"?"КРИТИЧНО":e.level==="warn"?"ВНИМАНИЕ":"ИНФО";td.appendChild(badge);tr.appendChild(td);body.appendChild(tr)})
}
function renderQueue(){
 const q=$("queueList");q.textContent="";let open=tickets.filter(function(t){return t.state==="Открыта"});$("queueCount").textContent=open.length+" "+(open.length===1?"заявка":"заявок");
 if(!open.length){q.innerHTML='<div class="empty">Очередь пока пуста. Создайте заявку из карточки выбранного объекта.</div>';return}
 open.slice(0,8).forEach(function(t){let el=document.createElement("div");el.className="ticket";el.innerHTML="<span><strong>"+t.device+" · "+t.priority+"</strong><small>"+t.created+" · "+t.reason+"</small></span><span class=\"ticket-status\">"+t.state+"</span>";q.appendChild(el)})
}
function renderAll(){devices.forEach(updateHealth);renderSystem();renderCards();renderMap();renderDetail();renderQueue();drawChart()}
function createTicket(){
 const d=device(selectedId),existing=tickets.find(function(t){return t.device===d.id&&t.state==="Открыта"});
 if(existing){toast("Для "+d.id+" уже есть открытая заявка");return}
 const priority=d.status==="bad"?"Критично":d.status==="warn"?"Высокий":"Плановый";
 const ticket={device:d.id,priority:priority,created:stamp(),reason:d.status==="good"?"плановая диагностика":"индекс "+d.health.toFixed(1)+"/100",state:"Открыта"};
 tickets.unshift(ticket);
 api("/api/tickets",{method:"POST",body:JSON.stringify({device_id:ticket.device,priority:ticket.priority,reason:ticket.reason,state:ticket.state,created_model_time:ticket.created})}).then(function(result){ticket.id=result.id;backendAvailable=true}).catch(markBackendUnavailable);
 addEvent(d.id,"Создана заявка на диагностику · "+priority,d.status==="bad"?"bad":d.status==="warn"?"warn":"info");renderSystem();renderQueue();toast("Заявка по "+d.id+" добавлена")
}
function randomDeviation(){
 const candidates=devices.filter(function(d){return d.type==="switch"}),d=candidates[Math.floor(Math.random()*candidates.length)];
 d.time=round(d.time+.4+Math.random()*.8,1);d.current=round(d.current+.25+Math.random()*.6,2);d.temp=round(d.temp+2+Math.random()*5,1);d.cycles+=3000;updateHealth(d);persistDevices().catch(function(){});
 addEvent(d.id,"Смоделировано отклонение: рост времени, тока и температуры",d.status==="bad"?"bad":"warn");selectedId=d.id;setDiagnosticFromDevice(d);renderAll();toast("Случайное отклонение задано для "+d.id)
}
function loseControl(){
 const d=device("SW-17");d.control=false;d.forcedBad=true;d.failures++;updateHealth(d);persistDevices().catch(function(){});selectedId=d.id;addEvent(d.id,"Потеря контроля положения","bad");setDiagnosticFromDevice(d);renderAll();toast("Для SW-17 смоделирована потеря контроля")
}
function occupyTrack(){
 const d=device("TC-03");d.occupied=!d.occupied;updateHealth(d);persistDevices().catch(function(){});selectedId=d.id;addEvent(d.id,"Состояние рельсовой цепи: "+(d.occupied?"участок занят":"участок свободен"),"info");setDiagnostic("good","Состояние участка · "+d.id,d.occupied?"Рельсовая цепь показывает занятость. Это штатное состояние индикации и не означает отказ само по себе.":"Участок снова отображается свободным.","Сопоставьте состояние участка с процедурой демонстрации; не трактуйте занятость как неисправность автоматически.");renderAll();toast(d.id+": "+(d.occupied?"занят":"свободен"))
}
function startDegradation(){
 const d=device("SW-17");degradation=true;selectedId=d.id;d.control=true;d.forcedBad=false;
 if(d.time<4.2){d.time=4.2;d.current=4.65;d.temp=33}
 persistDevices().catch(function(){});addEvent(d.id,"Запущен сценарий постепенного износа привода","info");setDiagnostic("warn","Сценарий активен: ухудшение SW-17","Пока симуляция идёт, модель постепенно увеличивает время перевода, ток и температуру привода.","Запустите ход времени или нажимайте «Шаг +1 ч». Следите за трендом и изменением индекса.");renderAll();toast("Сценарий износа запущен: "+d.id)
}
function saveSample(){
 devices.forEach(function(d){history[d.id].push(metricValue(d,$("chartMetric").value));if(history[d.id].length>72)history[d.id].shift()});
 persistTelemetry();persistDevices().catch(function(){})
}
function advance(minutes){
 const oldHour=Math.floor(simMinutes/60);simMinutes+=minutes;
 if(degradation){let d=device("SW-17");let h=minutes/60;d.time=round(d.time+.15*h,2);d.current=round(d.current+.19*h,2);d.temp=round(d.temp+.65*h,1);d.cycles+=Math.round(34*h);updateHealth(d)}
 const newHour=Math.floor(simMinutes/60);if(newHour>oldHour){for(let i=oldHour;i<newHour;i++)saveSample()}
 $("modelClock").textContent=clockText();renderSystem();renderCards();renderMap();updateDetailLive();drawChart()
}
function toggleRun(){
 running=!running;clearInterval(timer);timer=null;
 $("runBtn").textContent=running?"Ⅱ Пауза":"▶ Запустить";
 if(running){timer=setInterval(function(){advance(Number($("speedSelect").value))},1000);addEvent("Система","Симуляция запущена","info");toast("Симуляция запущена")}
 else{addEvent("Система","Симуляция поставлена на паузу","info");toast("Симуляция остановлена")}
 renderSystem()
}
function step(){advance(60);addEvent("Система","Время модели увеличено на 1 час","info");renderLog();toast("Модельное время: "+clockText())}
function drawChart(){
 const canvas=$("historyChart");if(!canvas)return;let rect=canvas.getBoundingClientRect();if(rect.width<10)return;
 const scale=window.devicePixelRatio||1;canvas.width=Math.round(rect.width*scale);canvas.height=Math.round(rect.height*scale);const c=canvas.getContext("2d");c.scale(scale,scale);
 const w=rect.width,h=rect.height,p={l:38,r:10,t:14,b:24};c.clearRect(0,0,w,h);
 const d=device(selectedId),key=$("chartMetric").value,raw=history[d.id]||[],vals=raw.slice(-72);
 if(vals.length<2)vals=Array(72).fill(metricValue(d,key));
 vals[vals.length-1]=metricValue(d,key);
 let min=Math.min.apply(null,vals),max=Math.max.apply(null,vals);if(min===max){let pad=Math.max(Math.abs(min)*.08,1);min-=pad;max+=pad}else{let pad=(max-min)*.16;min-=pad;max+=pad}
 c.font="9px Segoe UI,Arial";c.textAlign="right";c.textBaseline="middle";
 for(let i=0;i<4;i++){let y=p.t+(h-p.t-p.b)*i/3;c.strokeStyle="#29384d";c.lineWidth=1;c.beginPath();c.moveTo(p.l,y);c.lineTo(w-p.r,y);c.stroke();let val=max-(max-min)*i/3;c.fillStyle="#8295ad";c.fillText(val.toFixed(key==="health"?0:1),p.l-7,y)}
 c.strokeStyle="#4fd1a5";c.lineWidth=2;c.beginPath();
 vals.forEach(function(v,i){let x=p.l+(w-p.l-p.r)*i/(vals.length-1),y=p.t+(h-p.t-p.b)*(max-v)/(max-min);if(i===0)c.moveTo(x,y);else c.lineTo(x,y)});c.stroke();
 let last=vals[vals.length-1],lx=w-p.r,ly=p.t+(h-p.t-p.b)*(max-last)/(max-min);c.fillStyle="#4fd1a5";c.beginPath();c.arc(lx,ly,3.5,0,Math.PI*2);c.fill();
 c.fillStyle="#8295ad";c.textAlign="left";c.textBaseline="alphabetic";c.fillText("−72 ч",p.l,h-5);c.textAlign="right";c.fillText("сейчас",w-p.r,h-5);
 $("chartCaption").textContent=d.id+" · "+metricNames[key];$("chartCurrent").textContent=formatValue(d,key)
}
function exportCsv(){
 const lines=[["Тип записи","Время модели","Объект","Показатель / событие","Значение","Уровень"].join(";")];
 function row(values){return values.map(function(x){return '"'+String(x==null?"":x).replace(/"/g,'""')+'"'}).join(";")}
 events.slice().reverse().forEach(function(e){lines.push(row(["Событие",e.time,e.device,e.message,"",e.level||"info"]))});
 const key=$("chartMetric").value;
 for(let i=0;i<72;i++){const when=i===71?"сейчас":"−"+(71-i)+" ч";devices.forEach(function(d){const values=history[d.id]||[],v=values[Math.max(0,values.length-72+i)];lines.push(row(["Телеметрия",when,d.id,metricNames[key],v,"инфо"]))})}
 const csv="\ufeff"+lines.join("\r\n"),blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="smart-scb-history.csv";a.click();setTimeout(function(){URL.revokeObjectURL(url)},1000);toast("История телеметрии и событий выгружена в CSV")
}
function reset(){
 if(running){running=false;clearInterval(timer);timer=null;$("runBtn").textContent="▶ Запустить"}
 simMinutes=0;degradation=false;devices.forEach(function(d){d.failures=0;d.forcedBad=false;d.occupied=false;d.control=true;d.lamp=true;d.cycles=d.type==="switch"?2500+(Number(d.id.slice(3))-11)*620:1000;d.temp=d.type==="switch"?31+(Number(d.id.slice(3))-11)%4:d.type==="track"?29+(Number(d.id.slice(3))-1)%3:30+(Number(d.id.slice(3))-1)%4;d.time=d.type==="switch"?round(3.8+(Number(d.id.slice(3))-11)%4*.16,1):0;d.current=d.type==="switch"?round(4.35+(Number(d.id.slice(3))-11)%3*.12,2):d.type==="track"?round(.22+(Number(d.id.slice(3))-1)%3*.04,2):round(.42+(Number(d.id.slice(3))-1)%3*.03,2);d.nominalCurrent=d.type==="switch"?4.45:d.type==="track"?.25:.45;d.voltage=d.type==="switch"?24:d.type==="track"?round(2.8+(Number(d.id.slice(3))-1)%3*.1,1):round(24+(Number(d.id.slice(3))-1)%3,1);d.position=d.type==="switch"?"Плюсовое":d.type==="signal"?"Красный":"—";updateHealth(d);history[d.id]=Array(72).fill(d.health)});
 selectedId="SW-17";persistDevices().catch(function(){});addEvent("Система","Сброшена учебная симуляция","info");setDiagnostic("good","Диагностика: отклонений нет","Все устройства возвращены к исходным синтетическим показаниям.","Продолжайте наблюдение за телеметрией.");renderAll();renderLog();toast("Симуляция сброшена")
}
$("deviceGrid").addEventListener("click",function(e){let card=e.target.closest("[data-device]");if(card)selectDevice(card.getAttribute("data-device"))});
$("deviceGrid").addEventListener("keydown",function(e){if((e.key==="Enter"||e.key===" ")&&e.target.matches("[data-device]")){e.preventDefault();selectDevice(e.target.getAttribute("data-device"))}});
$("reloadDbBtn").addEventListener("click",function(){reloadDevicesFromDatabase(true)});
$("runBtn").addEventListener("click",toggleRun);$("stepBtn").addEventListener("click",step);$("scenarioBtn").addEventListener("click",startDegradation);$("slowBtn").addEventListener("click",startDegradation);$("lostBtn").addEventListener("click",loseControl);$("occupyBtn").addEventListener("click",occupyTrack);$("randomBtn").addEventListener("click",randomDeviation);$("ticketBtn").addEventListener("click",createTicket);$("exportBtn").addEventListener("click",exportCsv);$("resetBtn").addEventListener("click",reset);
$("clearLogBtn").addEventListener("click",function(){events=[];saveEvents();renderLog();api("/api/events",{method:"DELETE"}).then(function(){backendAvailable=true;toast("Журнал очищен")}).catch(function(){markBackendUnavailable();toast("Локальный журнал очищен")})});
$("chartMetric").addEventListener("change",function(){devices.forEach(function(d){history[d.id]=Array(72).fill(metricValue(d,$("chartMetric").value))});drawChart();loadTelemetry(selectedId)});
window.addEventListener("resize",drawChart);
buildMap();renderAll();renderLog();loadServerState();
})();
