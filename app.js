/* ============================================================
   Shri Ji Mess — Supabase-backed version
   All data now lives in a shared Supabase database instead of
   this browser's localStorage, so every student, the kitchen,
   and the admin all see the same live data.
   ============================================================ */
const SUPABASE_URL="https://pjhumhmzmcsiibyulsrx.supabase.co";
const SUPABASE_KEY="sb_publishable_4vUQw3phbfGIKBcSXrZF0w_hPrYYfDH";
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const PHONE_KEY="sjmPhone";

let me=null;            // the logged-in student's row from `students`
let products=[];        // café menu, loaded from `products`
let settings=null;      // single settings row (whatsapp, prices, meal times, qr)
let cart=[];            // in-memory only until checkout
let pendingCafe=null;   // in-memory only, cleared once confirmed
let kitchenTimer=null, kitchenSeenIds=null;

function esc(x){return String(x).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function today(){return new Date().toISOString().slice(0,10)}
function dayName(){return new Intl.DateTimeFormat("en-US",{weekday:"long"}).format(new Date())}
function toast(x){let t=document.getElementById("toast");t.textContent=x;t.style.display="block";clearTimeout(window.tt);window.tt=setTimeout(()=>t.style.display="none",2200)}
function closeModal(){let m=document.querySelector(".modal");if(m)m.remove()}
function modal(html,dismissible=true){let m=document.createElement("div");m.className="modal";m.innerHTML=`<div class="sheet">${html}</div>`;if(dismissible)m.onclick=e=>{if(e.target===m)closeModal()};document.body.appendChild(m)}
function loading(msg){document.getElementById("app").innerHTML=`<div class="page" style="text-align:center;padding-top:60px"><h2>${msg||"Loading..."}</h2></div>`}
async function safeCall(promise,errMsg){
  try{
    const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),12000));
    const r=await Promise.race([promise,timeout]);
    if(r.error){toast((errMsg||"Something went wrong")+": "+r.error.message);return null}
    return r;
  }
  catch(err){
    toast(err.message==="timeout" ? "Network bahut slow hai — dobara try karein" : ((errMsg||"Network error")+" — check your internet"));
    return null;
  }
}

function mealWindow(meal){
  let [h,m]=settings.meal_times[meal].split(":").map(Number), now=new Date(), target=new Date();target.setHours(h,m,0,0);
  let start=new Date(target-3600000);
  return {active:now>=start&&now<target,closed:now>=target,target}
}

/* ============================ BOOT / LOGIN ============================ */
const VAPID_PUBLIC_KEY="BBDNbgM_xL1Wbxm77bjFeh8FfDKjw2ThSQX3G3R_vtk3Nj8eQu8qzlErdareVBHki-gwJPFBhxdSgNKAwdkia7A";
function urlBase64ToUint8Array(base64String){
 const padding="=".repeat((4-base64String.length%4)%4);
 const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
 const raw=atob(base64);
 return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}
async function enablePush(){
 try{
   if(!("serviceWorker" in navigator)||!("PushManager" in window)){toast("Is browser me push notifications supported nahi hain");return}
   const perm=await Notification.requestPermission();
   if(perm!=="granted"){toast("Notification permission allow nahi hui");return}
   const reg=await navigator.serviceWorker.register("./sw.js");
   await navigator.serviceWorker.ready;
   let sub=await reg.pushManager.getSubscription();
   if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)});
   const j=sub.toJSON();
   const r=await safeCall(sb.from("push_subscriptions").upsert({endpoint:j.endpoint,p256dh:j.keys.p256dh,auth:j.keys.auth},{onConflict:"endpoint"}),"Couldn't save push subscription");
   if(!r)return;
   toast("🔔 Push notifications enabled — ab screen band hone par bhi alert milega");
   kitchen();
 }catch(err){toast("Push setup fail hua: "+err.message)}
}
async function boot(){
  if("serviceWorker" in navigator){navigator.serviceWorker.register("./sw.js").catch(()=>{})}
  loading("Shri Ji Mess loading...");
  const s=await safeCall(sb.from("settings").select("*").eq("id",1).single(),"Couldn't load settings");
  settings=s?.data||{whatsapp:"",daily_price:150,qr_url:"",admin_pin:"1234",kitchen_pin:"5678",meal_times:{Breakfast:"08:00",Lunch:"13:00",Snack:"17:00",Dinner:"20:00"}};
  const p=await safeCall(sb.from("products").select("*").order("id"),"Couldn't load menu");
  products=p?.data||[];
  if(window.IS_STAFF_APP){staffHome();return}
  const panel=new URLSearchParams(location.search).get("panel");
  if(panel==="kitchen"){requireRole("kitchen",kitchen);return}
  if(panel==="admin"){requireRole("admin",admin);return}
  const phone=localStorage.getItem(PHONE_KEY);
  if(phone){
    const r=await safeCall(sb.from("students").select("*").eq("phone",phone).maybeSingle(),"Couldn't load your profile");
    if(r?.data){me=r.data;home();return}
  }
  register();
}
function staffHome(){
 document.getElementById("app").innerHTML=`<div class="page" style="text-align:center;padding-top:55px">
  <div style="font-size:52px">🩺</div><h2>Shri Ji Mess</h2><p class="muted">Staff Dashboard</p>
  <button class="btn" style="max-width:280px;margin:18px auto" onclick="requireRole('staff',staffDashboard)">🔐 Open Staff Dashboard</button>
 </div>`;
}
function staffDashboard(){ admin(); }
function register(){modal(`<h2>🌸 Welcome to Shri Ji Mess</h2><p class=muted>Registration is simple — only 4 details. Already registered? Enter the same phone number to log back in.</p><label class=label>Name</label><input class=input id=rn placeholder="Your name"><label class=label>Phone Number</label><input class=input id=rph type=tel placeholder="10-digit mobile number" maxlength=10><label class=label>Batch</label><input class=input id=rb placeholder="2026"><label class=label>Room No.</label><input class=input id=rr placeholder="A-104"><button class=btn onclick="registerSave()">Continue</button>`,false)}
async function registerSave(){
  let n=document.getElementById("rn").value.trim(),ph=document.getElementById("rph").value.replace(/\D/g,""),b=document.getElementById("rb").value.trim(),r=document.getElementById("rr").value.trim();
  if(!n||!ph||!b||!r)return toast("Please fill all fields");
  if(ph.length!==10)return toast("Enter a valid 10-digit phone number");
  const existing=await safeCall(sb.from("students").select("*").eq("phone",ph).maybeSingle(),"Couldn't check phone number");
  if(!existing)return;
  if(existing.data){
    me=existing.data;
    localStorage.setItem(PHONE_KEY,ph);
    closeModal();toast("Welcome back, "+me.name.split(" ")[0]+"!");
    home();return;
  }
  const ins=await safeCall(sb.from("students").insert({name:n,phone:ph,batch:b,room:r,plan:"",amount:0,payment:"Pending"}).select().single(),"Registration failed");
  if(!ins)return;
  me=ins.data;
  localStorage.setItem(PHONE_KEY,ph);
  closeModal();
  planModal();
}
function logout(){stopReminders();localStorage.removeItem(PHONE_KEY);me=null;toast("Logged out");register()}
function planModal(){modal(`<h2>Choose Mess Plan</h2><div class=card><div class=row><div><b>Monthly Plan</b><div class=muted>Full month</div></div><b>₹3,800</b></div><button class=btn style="margin-top:10px" onclick="choosePlan('Monthly')">Select Monthly</button></div><div class=card><div class=row><div><b>Daily Plan</b><div class=muted>Admin configured</div></div><b>₹${settings.daily_price}/day</b></div><button class="btn secondary" style="margin-top:10px" onclick="choosePlan('Daily')">Select Daily</button></div>`)}
async function choosePlan(p){
  const amount=p=="Monthly"?3800:settings.daily_price;
  const r=await safeCall(sb.from("students").update({plan:p,amount}).eq("id",me.id).select().single(),"Couldn't save plan");
  if(!r)return;
  me=r.data;closeModal();paymentModal();
}

function requireRole(role,cb){
 const sessionKey="sjmStaffOk";
 if(sessionStorage.getItem(sessionKey)==="1"){cb();return}
 const pin=prompt("Enter Staff PIN");
 if(pin===null){lockedScreen(role,cb);return}
 const expected=String(settings.admin_pin||"1234");
 if(pin===expected){sessionStorage.setItem(sessionKey,"1");cb()}
 else{toast("❌ Galat PIN");lockedScreen(role,cb)}
}
function lockedScreen(role,cb){
 document.getElementById("app").innerHTML=`<div class="page" style="text-align:center;padding-top:80px">
  <div style="font-size:50px">🔒</div>
  <h2>${role==="admin"?"Admin":"Kitchen"} Panel Locked</h2>
  <p class="muted">PIN daalke unlock karein</p>
  <button class="btn" style="max-width:220px;margin:20px auto" onclick="requireRole('${role}',${role==="admin"?"admin":"kitchen"})">🔓 Unlock</button>
 </div>`;
}

/* ============================ NAV / SHELL ============================ */
function nav(active){
 return `<div class="bottom">
 <button class="nav ${active=="home"?"active":""}" onclick="show('home')"><b>🏠</b>Home</button>
 <button class="nav ${active=="meals"?"active":""}" onclick="show('meals')"><b>🍽️</b>Meals</button>
 <button class="nav ${active=="poll"?"active":""}" onclick="show('poll')"><b>🗳️</b>Poll</button>
 <button class="nav ${active=="cafe"?"active":""}" onclick="show('cafe')"><b>☕</b>Café</button>
 <button class="nav ${active=="profile"?"active":""}" onclick="show('profile')"><b>👤</b>Profile</button></div>`
}
function shell(content,active){
 ensureReminders();
 document.getElementById("app").innerHTML=`<div class="top"><div><div class="brand">🌸 Shri Ji Mess</div><div class="sub">Doctor Hostel Mess & Café</div></div><span class="pill">${esc(me.room||"")}</span></div><div class="page">${content}</div>${nav(active)}`}
function show(page){
 if(page=="home") home(); if(page=="meals") meals();if(page=="poll") poll();if(page=="cafe") cafe();if(page=="profile") profile();
}

/* ============================ MEAL STATUS (per student) ============================ */
async function myTodayMealRecords(){
  const r=await safeCall(sb.from("meal_records").select("*").eq("student_phone",me.phone).eq("meal_date",today()),"Couldn't load today's meals");
  return r?.data||[];
}
async function myActiveLeave(){
  const r=await safeCall(sb.from("leaves").select("*").eq("student_phone",me.phone).lte("from_date",today()).gte("to_date",today()),"Couldn't check leave");
  return (r?.data||[])[0]||null;
}
function statusFrom(records,leave,meal){
  if(leave)return "Skipped";
  const rec=records.find(r=>r.meal===meal);
  return rec&&rec.skipped?"Skipped":"Present";
}
async function upsertMealRecord(meal,fields){
  const r=await safeCall(sb.from("meal_records").upsert({student_phone:me.phone,meal_date:today(),meal,...fields},{onConflict:"student_phone,meal_date,meal"}).select().single(),"Couldn't save");
  return r;
}

/* ============================ HOME ============================ */
let remindersStarted=false, remindersTimer=null;
function ensureReminders(){if(remindersStarted)return;remindersStarted=true;checkSkipReminders();remindersTimer=setInterval(checkSkipReminders,60000)}
function stopReminders(){if(remindersTimer){clearInterval(remindersTimer);remindersTimer=null}remindersStarted=false}
async function home(){
 loading("Loading home...");
 const [records,leave,pollRow]=await Promise.all([myTodayMealRecords(),myActiveLeave(),loadTodayPoll()]);
 let mealMeta={Breakfast:["🍳","Breakfast"],Lunch:["🍛","Lunch"],Snack:["🥤","Snack"],Dinner:["🌙","Dinner"]};
 let mealsHtml=["Breakfast","Lunch","Snack","Dinner"].map(m=>{
   let w=mealWindow(m), st=statusFrom(records,leave,m), meta=mealMeta[m];
   return `<div class="meal">
     <div class="row">
       <div style="display:flex;gap:10px;align-items:center">
         <div style="width:42px;height:42px;border-radius:13px;background:#f0f7f7;display:grid;place-items:center;font-size:22px">${meta[0]}</div>
         <div><b>${meta[1]}</b><div class="sub">${settings.meal_times[m]}</div></div>
       </div>
       <div style="text-align:right"><div class="status ${st=="Present"?"present":"skipped"}">${st=="Present"?"PRESENT ✓":"SKIPPED ✕"}</div>${w.active&&st=="Present"?`<button class="btn small danger" style="margin-top:6px" onclick="skipMeal('${m}')">Skip</button>`:""}</div>
     </div>
   </div>`;
 }).join("");
 const notices=await activeNotices();
 shell(`
 <div class="card hero">
   <div class="hero-copy">
     <div class="eyebrow">${dayName()} mess pass</div>
     <h2>Hi, ${esc(me.name.split(" ")[0])} 👋</h2>
     <div class="muted">Room ${esc(me.room)}, Batch ${esc(me.batch)}</div>
     <div class="hero-plan">✦ ${me.plan=="Monthly"?"Monthly ₹"+me.amount:"Daily ₹"+me.amount} <span>• Active</span></div>
   </div>
   <svg class="hero-art" viewBox="0 0 160 160" aria-hidden="true">
     <circle cx="90" cy="82" r="57" fill="rgba(255,255,255,.12)"/>
     <path d="M58 56v23c0 23 18 41 41 41s41-18 41-41V56" fill="none" stroke="white" stroke-width="7" stroke-linecap="round"/>
     <circle cx="58" cy="53" r="9" fill="white"/>
     <path d="M52 125c7 11 19 17 33 17h14" fill="none" stroke="white" stroke-width="7" stroke-linecap="round"/>
     <circle cx="105" cy="142" r="11" fill="none" stroke="white" stroke-width="6"/>
     <path d="M89 82h17l7-13 8 27 8-18 6 9h13" fill="none" stroke="#b8fff0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
   </svg>
 </div>

 <div class="card">
   <div class="row"><div><div class="section-title">Today's meals</div><div class="sub">You're automatically Present unless you skip.</div></div><span class="pill">4 meals</span></div>
   ${mealsHtml}
 </div>

 ${pollRow?`<div class="card" style="background:linear-gradient(135deg,#f0f7ff,#fff)">
   <div class="row"><div><div class="section-title">🗳️ Today's Food Poll</div><div class="sub">${pollRow.meal} · Vote for your choice</div></div><button class="btn small" onclick="show('poll')">${pollRow.myVote!=null?"View":"Vote"}</button></div>
   ${pollRow.myVote!=null&&pollRow.winner?`<div class="sub" style="margin-top:8px">🏆 Trending: <b>${esc(pollRow.winner.name)}</b> (${pollRow.winner.votes} vote${pollRow.winner.votes>1?"s":""})</div>`:""}
 </div>`:""}

 <div class="section-title" style="margin:18px 2px 8px">Quick access</div>
 <div class="quick-actions">
   <button class="quick-tile" onclick="show('cafe')"><span>☕</span><b>Shri Ji Café</b><small class="muted">Order & pickup</small></button>
   <button class="quick-tile" onclick="leaveModal()"><span>🏠</span><b>Leave Mode</b><small class="muted">Manage leave</small></button>
   <button class="quick-tile" onclick="feedbackModal()"><span>⭐</span><b>Feedback</b><small class="muted">Share experience</small></button>
   <button class="quick-tile" onclick="complaintModal()"><span>📝</span><b>Request Help</b><small class="muted">Complaint / request</small></button>
 </div>

 <div class="card notice"><div class="row"><div><b>📢 Campus notice</b><div style="margin-top:6px">${notices.length?esc(notices[0].text):"No new notices."}</div></div><button class="btn small secondary" onclick="noticesModal()">View all</button></div></div>
 `, "home")
}
async function skipMeal(m){
 const w=mealWindow(m);if(!w.active){toast("Skip window is closed");return}
 const r=await upsertMealRecord(m,{skipped:true});
 if(!r)return;
 toast(m+" skipped");home();
}

/* ============================ MEALS PAGE ============================ */
async function meals(){
 loading("Loading meals...");
 const [records,leave]=await Promise.all([myTodayMealRecords(),myActiveLeave()]);
 const mealNames=["Breakfast","Lunch","Snack","Dinner"];
 shell(`<div class="card hero"><h2>🍽️ Today's Meals</h2><p>Meal automatically counts you as <b>Present ✅</b>. You only need to skip when required.</p></div>
 ${mealNames.map(m=>{
   const st=statusFrom(records,leave,m);
   const w=mealWindow(m);
   const rec=records.find(x=>x.meal===m);
   const choice=rec?.serving||"Dine-in";
   const sick=!!rec?.sick_light_diet;
   return `<div class="card meal-card">
    <div class="row"><h3>${m}</h3><span class="pill">${st==="Skipped"?"SKIPPED ❌":"PRESENT ✅"}</span></div>
    <div class="sub">${settings.meal_times[m]} • Skip window: 1 hour before meal</div>
    <div style="margin-top:10px"><b>How will you take your meal?</b>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn small ${choice==="Dine-in"?"primary":"secondary"}" onclick="setMealServing('${m}','Dine-in')">🍽️ Dine-in</button>
        <button class="btn small ${choice==="Packed"?"primary":"secondary"}" onclick="setMealServing('${m}','Packed')">📦 Pack</button>
      </div>
    </div>
    ${w.active&&st==="Present"?`<button class="btn danger" style="margin-top:10px" onclick="skipMeal('${m}')">SKIP ${m.toUpperCase()}</button>`:""}
    ${!w.closed?`<button class="btn small ${sick?"primary":"secondary"}" style="margin-top:8px" onclick="toggleSickMeal('${m}')">${sick?"🤒 Light Diet Requested — Cancel":"🤒 Not Feeling Well? Request Light Diet"}</button>`:""}
    ${!w.active?`<div class="sub" style="margin-top:8px">Pack/Dine-in can be selected anytime. Skip is available only during the 1-hour window.</div>`:""}
   </div>`;
 }).join("")}`,"meals")
}
async function setMealServing(meal,serving){
 const r=await upsertMealRecord(meal,{serving});
 if(!r)return;
 toast(`${meal}: ${serving==="Packed"?"📦 Pack":"🍽️ Dine-in"} selected`);
 meals();
}
async function toggleSickMeal(m){
 const w=mealWindow(m);
 if(w.closed){toast("Too late — meal already prepared");return}
 const records=await myTodayMealRecords();
 const rec=records.find(x=>x.meal===m);
 const next=!(rec&&rec.sick_light_diet);
 const r=await upsertMealRecord(m,{sick_light_diet:next});
 if(!r)return;
 toast(next?"🤒 Light diet requested for "+m:"Light diet request removed");
 meals();
}
function checkSkipReminders(){
 if(!me)return;
 // lightweight, local-only reminder (doesn't need network) using a per-device seen-set
 const now=new Date(); let seen=JSON.parse(localStorage.getItem("sjmReminded")||"{}");
 ["Breakfast","Lunch","Snack","Dinner"].forEach(async m=>{
   const w=mealWindow(m), key=today()+"_"+m, msLeft=w.target-now;
   if(!w.closed && msLeft>0 && msLeft<=15*60000 && !seen[key]){
     const records=await myTodayMealRecords();
     const leave=await myActiveLeave();
     if(statusFrom(records,leave,m)==="Present"){
       seen[key]=true;localStorage.setItem("sjmReminded",JSON.stringify(seen));
       toast("⏰ "+m+" ka skip window 15 min me band ho raha hai!");
     }
   }
 });
}

/* ============================ ATTENDANCE SUMMARY ============================ */
async function attendanceSummary(){
 const ym=today().slice(0,7);
 const yearNum=+ym.slice(0,4), monthNum=+ym.slice(5,7);
 const lastDay=new Date(yearNum,monthNum,0).getDate();
 const ymEnd=ym+"-"+String(lastDay).padStart(2,"0");
 const r=await safeCall(sb.from("meal_records").select("meal_date,skipped").eq("student_phone",me.phone).eq("skipped",true).gte("meal_date",ym+"-01").lte("meal_date",ymEnd),"Couldn't load attendance");
 const skipped=(r?.data||[]).length;
 const lv=await safeCall(sb.from("leaves").select("from_date,to_date").eq("student_phone",me.phone),"Couldn't load leaves");
 let leaveDays=0;
 (lv?.data||[]).forEach(l=>{
   let from=l.from_date<ym+"-01"?ym+"-01":l.from_date, to=l.to_date>ymEnd?ymEnd:l.to_date;
   if(to<ym+"-01"||from>ymEnd)return;
   leaveDays+=Math.max(0,Math.round((new Date(to)-new Date(from))/86400000)+1);
 });
 return {skipped,leaveDays};
}

/* ============================ POLLS ============================ */
async function loadTodayPoll(){
 const d=dayName();
 const r=await safeCall(sb.from("polls").select("*").eq("day",d).maybeSingle(),"Couldn't load poll");
 const p=r?.data; if(!p)return null;
 const votesR=await safeCall(sb.from("poll_votes").select("student_phone,option_index").eq("poll_day",d).eq("vote_date",today()),"Couldn't load votes");
 const votes=votesR?.data||[];
 const tallies=p.options.map((_,i)=>votes.filter(v=>v.option_index===i).length);
 const myVoteRow=votes.find(v=>v.student_phone===me.phone);
 const totalVotes=votes.length;
 let winner=null;
 if(totalVotes>0){const maxV=Math.max(...tallies);const idx=tallies.indexOf(maxV);winner={index:idx,name:p.options[idx],votes:maxV}}
 return {...p,myVote:myVoteRow?myVoteRow.option_index:null,tallies,totalVotes,winner};
}
async function poll(){
 loading("Loading poll...");
 const p=await loadTodayPoll();
 if(!p){shell(`<div class="card hero"><h2>🗳️ Food Poll</h2><p>No poll today.</p><p class="muted">Poll days: Tuesday Snack • Thursday Lunch • Saturday Breakfast • Sunday Lunch.</p></div>`,"poll");return}
 shell(`<div class="card hero"><h2>🗳️ ${p.meal} Poll</h2><p>${esc(p.question)}</p></div><div class="card">${p.options.map((o,i)=>{
   let pct=p.totalVotes?Math.round(p.tallies[i]/p.totalVotes*100):0;
   return p.myVote!=null
     ?`<div style="margin:8px 0"><div class="row"><span>${p.winner&&p.winner.index===i?"🏆 ":"○ "}${esc(o)}${p.myVote===i?" <b>(your vote)</b>":""}</span><b>${pct}%</b></div><div style="height:8px;border-radius:6px;background:#eef2f6;margin-top:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${p.winner&&p.winner.index===i?"#16a34a":"#0f766e"}"></div></div></div>`
     :`<button class="btn secondary" style="margin:5px 0" onclick="vote(${i})">○ ${esc(o)}</button>`;
 }).join("")}${p.myVote!=null?`<p class="present" style="margin-top:12px">Your vote is recorded. Attendance is not affected. Total votes: ${p.totalVotes}.</p>`:""}</div>`,"poll")
}
async function vote(i){
 const r=await safeCall(sb.from("poll_votes").insert({poll_day:dayName(),vote_date:today(),student_phone:me.phone,option_index:i}),"Couldn't record vote — you may have already voted");
 if(!r)return;
 toast("Vote recorded");poll();
}

/* ============================ CAFÉ ============================ */
function cartHtml(){
 return cart.map(x=>`<div class="meal" style="padding:9px 0">
   <div class="row">
    <span>${x.emoji} <b>${esc(x.name)}</b></span>
    <b>₹${x.price*x.qty}</b>
   </div>
   <div class="row" style="margin-top:7px">
    <div style="display:flex;align-items:center;gap:7px">
      <button class="btn small secondary" onclick="changeCartQty(${x.id},-1)">−</button>
      <b style="min-width:22px;text-align:center">${x.qty}</b>
      <button class="btn small secondary" onclick="changeCartQty(${x.id},1)">+</button>
    </div>
    <button class="btn small danger" onclick="removeCart(${x.id})">🗑️ Remove</button>
   </div>
 </div>`).join("")
}
function cartTotal(){return cart.reduce((a,x)=>a+x.price*x.qty,0)}
function addCart(id){let p=products.find(x=>x.id==id),x=cart.find(x=>x.id==id);if(x)x.qty++;else cart.push({...p,qty:1});toast(p.name+" added");cafe()}
function changeCartQty(id,delta){const x=cart.find(i=>i.id==id);if(!x)return;x.qty+=delta;if(x.qty<=0)cart=cart.filter(i=>i.id!=id);cafe()}
function removeCart(id){const x=cart.find(i=>i.id==id);cart=cart.filter(i=>i.id!=id);toast((x?.name||"Item")+" removed from cart");cafe()}
async function myOrders(){const r=await safeCall(sb.from("orders").select("*").eq("student_phone",me.phone).order("created_at",{ascending:false}),"Couldn't load orders");return r?.data||[]}
async function repeatLastOrder(){
 const orders=await myOrders(); const last=orders[0];
 if(!last){toast("No past order found");return}
 let added=0;
 last.items.forEach(([name,qty])=>{
   let p=products.find(x=>x.name===name&&x.available);
   if(!p)return; added++;
   let x=cart.find(c=>c.id===p.id);
   if(x)x.qty+=qty; else cart.push({...p,qty});
 });
 toast(added?"Last order added to cart":"Those items aren't available right now");
 cafe();
}
async function cafe(){
 loading("Loading café...");
 const orders=await myOrders();
 const availableProducts=products.filter(p=>p.available);
 const pending=orders.filter(o=>o.payment==="Pending");
 const pendingTotal=pending.reduce((a,o)=>a+o.total,0);
 shell(`<div class="card hero"><h2>☕ Shri Ji Café</h2><p>Order from your room and collect it at the mess. <b>No delivery.</b></p></div>
 ${orders.length?`<button class="btn secondary" onclick="repeatLastOrder()" style="margin-bottom:10px">🔁 Repeat Last Order</button>`:""}
 <div class="card"><h3>Menu</h3>${availableProducts.map(p=>`<div class="meal product"><div class="pic">${p.emoji}</div><div style="flex:1"><b>${esc(p.name)}</b><div class="price">₹${p.price}</div></div><button class="btn small" onclick="addCart(${p.id})">Add</button></div>`).join("")}</div>
 <div class="card"><div class="row"><h3>🛒 Cart</h3><b>${cart.reduce((a,x)=>a+x.qty,0)} items</b></div>${cartHtml()}${cart.length?`<div class="card" style="margin:8px 0"><b>How do you want your order?</b><div style="display:flex;gap:8px;margin-top:8px"><label style="flex:1;border:1px solid #ddd;border-radius:12px;padding:10px;text-align:center"><input type="radio" name="serving" value="Packed" checked> 📦 Packed</label><label style="flex:1;border:1px solid #ddd;border-radius:12px;padding:10px;text-align:center"><input type="radio" name="serving" value="Dine-in"> 🍽️ Dine-in</label></div></div><button class="btn" onclick="checkout()">Continue to Payment ₹${cartTotal()}</button>`:"<p class=muted>Cart is empty.</p>"}</div>
 <div class="card"><h3>📦 My Orders</h3>${orders.length?`
   ${pending.length?`<div style="background:#fff7f2;border-radius:12px;padding:10px;margin-bottom:10px"><b>💳 Pending Payments</b><div class="row"><span>${pending.length} order${pending.length>1?"s":""}</span><b>₹${pendingTotal}</b></div><button class="btn small" onclick="payAllPendingCafeOrders()">💳 Pay Total ₹${pendingTotal}</button></div>`:""}
   ${orders.map(o=>`<div class="meal"><div class="row"><b>#${o.id}</b><span class="pill">${o.status}</span></div><div>${o.items.map(x=>esc(x[0])+" × "+x[1]).join("<br>")}</div><div style="margin-top:4px"><b>₹${o.total}</b> • ${o.serving==="Dine-in"?"🍽️ Dine-in":"📦 Packed"}</div><div class="sub">Payment: ${esc(o.payment||"Pending")}</div>${o.status=="Ready for Pickup"?`<p class="present">🟢 READY FOR PICKUP • Pickup PIN: ${o.id.slice(-4)}</p>`:""}${o.payment==="Pending"?`<button class="btn small" style="margin-top:8px" onclick="payExistingCafeOrder('${o.id}')">💳 Pay ₹${o.total}</button>`:""}</div>`).join("")}`:"<p class=muted>No orders yet.</p>"}</div>`,"cafe")
}
function checkout(){
 if(!cart.length){toast("Cart is empty");return}
 const serving=document.querySelector('input[name="serving"]:checked')?.value||"Packed";
 const total=cartTotal(), id="SJ"+String(Math.floor(1000+Math.random()*9000));
 pendingCafe={id,items:cart.map(x=>[x.name,x.qty]),total,serving,student:me.name,room:me.room,phone:me.phone};
 paymentModal("cafe");
}
async function payAllPendingCafeOrders(){
 const orders=await myOrders();
 const pending=orders.filter(o=>o.payment==="Pending");
 if(!pending.length){toast("No pending café payment");return}
 pendingCafe={id:"MULTI",items:pending.flatMap(o=>o.items),total:pending.reduce((a,o)=>a+o.total,0),serving:"Multiple",student:me.name,room:me.room,phone:me.phone,existing:true,orderIds:pending.map(o=>o.id)};
 paymentModal("cafe");
}
async function payExistingCafeOrder(id){
 const orders=await myOrders(); const o=orders.find(x=>x.id===id);
 if(!o)return;
 pendingCafe={id:o.id,items:o.items,total:o.total,serving:o.serving||"Packed",student:me.name,room:me.room,phone:me.phone,existing:true};
 paymentModal("cafe");
}
async function notifyKitchenPush(order){
 try{
   await fetch(SUPABASE_URL+"/functions/v1/send-order-push",{
     method:"POST",
     headers:{"Content-Type":"application/json","Authorization":"Bearer "+SUPABASE_KEY,"apikey":SUPABASE_KEY},
     body:JSON.stringify({record:order})
   });
 }catch(err){/* push is best-effort; ignore failures so ordering never breaks */}
}
async function confirmCafePayment(){
 const p=pendingCafe;
 if(!p){toast("No pending café payment");return}
 if(p.existing){
   if(p.orderIds?.length){await safeCall(sb.from("orders").update({payment:"Screenshot Sent / Pending Verification"}).in("id",p.orderIds).eq("payment","Pending"),"Couldn't update payment")}
   else{await safeCall(sb.from("orders").update({payment:"Screenshot Sent / Pending Verification"}).eq("id",p.id),"Couldn't update payment")}
 }else{
   const r=await safeCall(sb.from("orders").insert({id:p.id,student_phone:me.phone,student_name:p.student,room:p.room,items:p.items,total:p.total,serving:p.serving,payment:"Screenshot Sent / Pending Verification",status:"New"}),"Couldn't place order");
   if(!r)return;
   cart=[];
   notifyKitchenPush({id:p.id,room:p.room,total:p.total});
 }
 pendingCafe=null;
 closeModal();toast("Order confirmed — payment pending Admin verification");cafe();
}

/* ============================ PROFILE ============================ */
async function profile(){
 loading("Loading profile...");
 const att=await attendanceSummary();
 const lv=await safeCall(sb.from("leaves").select("*").eq("student_phone",me.phone).order("id",{ascending:false}),"Couldn't load leave");
 const leaves=lv?.data||[];
 shell(`<div class="card"><h2>👤 Profile</h2><label class="label">Name</label><input class="input" id="pn" value="${esc(me.name)}"><label class="label">Phone Number</label><div class="input" style="background:#f5f8fc">${esc(me.phone)} <a href="tel:${esc(me.phone)}">📞 Call</a></div><label class="label">Batch</label><input class="input" id="pb" value="${esc(me.batch)}"><label class="label">Room No.</label><input class="input" id="pr" value="${esc(me.room)}"><label class="label">Allergy / Dietary Note</label><input class="input" id="pal" placeholder="e.g. no onion-garlic, Jain food" value="${esc(me.allergy_note||"")}"><button class="btn" onclick="saveProfile()">Save Profile</button></div>
 <div class="card"><h3>Plan</h3><div class="row"><span>${me.plan||"No plan"} Plan</span><b>₹${me.amount}</b></div><span class="pill">${me.payment}</span><button class="btn secondary" style="margin-top:12px" onclick="paymentModal()">💳 Payment / QR</button></div>
 <div class="card"><h3>📊 This Month's Attendance</h3><div class="row"><span class="sub">Meals skipped</span><b>${att.skipped}</b></div><div class="row" style="margin-top:6px"><span class="sub">Leave days</span><b>${att.leaveDays}</b></div></div>
 <div class="card"><h3>🏠 Leave</h3>${leaves.length?leaves.map(l=>`<p>On leave: ${l.from_date} → ${l.to_date} <button class="btn small danger" onclick="cancelLeave(${l.id})">Cancel</button></p>`).join(""):"<p class=muted>No active leave.</p>"}</div>
 <div class="card"><h3>⚙️ Account</h3><button class="btn danger" onclick="logout()">🚪 Log Out</button></div>`,"profile")
}
async function saveProfile(){
 const r=await safeCall(sb.from("students").update({name:document.getElementById("pn").value,batch:document.getElementById("pb").value,room:document.getElementById("pr").value,allergy_note:document.getElementById("pal").value}).eq("id",me.id).select().single(),"Couldn't save profile");
 if(!r)return;
 me=r.data;toast("Profile saved");profile();
}
function leaveModal(){modal(`<h2>🏠 Leave Mode</h2><label class=label>From</label><input class=input type=date id=lf value="${today()}"><label class=label>To</label><input class=input type=date id=lt value="${today()}"><button class=btn onclick="setLeave()">Activate Leave</button>`)}
async function setLeave(){
 let a=document.getElementById("lf").value,b=document.getElementById("lt").value;
 if(!a||!b||b<a)return toast("Select valid dates");
 const r=await safeCall(sb.from("leaves").insert({student_phone:me.phone,from_date:a,to_date:b}),"Couldn't set leave");
 if(!r)return;
 closeModal();toast("Leave activated");home();
}
async function cancelLeave(id){await safeCall(sb.from("leaves").delete().eq("id",id),"Couldn't cancel leave");toast("Leave cancelled");profile()}

/* ============================ PAYMENT MODAL ============================ */
function paymentModal(mode="monthly"){
 const isCafe=mode==="cafe", p=pendingCafe;
 const qr=settings.qr_url
   ? `<img src="${settings.qr_url}" alt="UPI QR" style="width:190px;height:190px;object-fit:contain;border-radius:12px;border:1px solid #eee">`
   : `<div style="width:190px;height:190px;margin:auto;border:2px dashed #ccc;border-radius:12px;display:grid;place-items:center;color:#888">UPI QR<br><small>Admin QR not uploaded</small></div>`;
 const msg=isCafe&&p
   ? `Shri Ji Cafe Payment Screenshot - Order ${p.id} - ${p.student} - Room ${p.room} - ₹${p.total}`
   : `Shri Ji Mess Payment Screenshot - ${me.name} Room ${me.room}`;
 const wa=settings.whatsapp||"";
 const waUrl=wa ? `https://wa.me/${String(wa).replace(/\D/g,"")}?text=${encodeURIComponent(msg)}` : "#";
 const waAttr=wa ? "" : `onclick="event.preventDefault();toast('Admin WhatsApp number not added')"`;
 const summary=isCafe&&p
   ? `<div class="card" style="text-align:left"><b>${p.id==="MULTI"?"Combined Café Payment":"Order #"+p.id}</b><br>${p.items.map(x=>`${esc(x[0])} × ${x[1]}`).join("<br>")}<br><b>Total Payment: ₹${p.total}</b>${p.serving!=="Multiple"?`<br>${p.serving==="Dine-in"?"🍽️ Dine-in":"📦 Packed"}`:""}</div>`
   : "";
 const done=isCafe
   ? `<button class="btn" onclick="confirmCafePayment()">✅ Screenshot Sent — Confirm Order</button>`
   : `<button class="btn" onclick="confirmMessPayment()">✅ Screenshot Sent — Done</button>`;
 modal(`<div class="modal-head"><b>${isCafe?"☕ Shri Ji Café Payment":"Shri Ji Mess Payment"}</b><span onclick="closeModal()">✕</span></div>
 ${summary}
 <div style="text-align:center">${qr}
 <p><b>QR Scan karke payment karein</b><br>aur payment ka screenshot WhatsApp par bhej dein.</p>
 <a class="btn primary" href="${waUrl}" target="_blank" ${waAttr}>📲 Send Payment Screenshot on WhatsApp</a>
 ${done}</div>`);
}
async function confirmMessPayment(){
 const r=await safeCall(sb.from("students").update({payment:"Screenshot Sent / Pending Verification"}).eq("id",me.id).select().single(),"Couldn't update payment");
 if(!r)return;
 me=r.data;closeModal();toast("Payment noted — admin will verify");profile();
}

/* ============================ FEEDBACK / COMPLAINTS / NOTICES ============================ */
function feedbackModal(){modal(`<h2>⭐ Food Feedback</h2><label class=label>Rating</label><select class=input id=fr><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select><input class=input id=ft placeholder="Taste feedback"><input class=input id=fq placeholder="Quality feedback"><input class=input id=fn placeholder="Quantity feedback"><textarea class=input id=fs placeholder="Suggestion"></textarea><button class=btn onclick="sendFeedback()">Submit Feedback</button>`)}
async function sendFeedback(){
 const r=await safeCall(sb.from("feedback").insert({student_phone:me.phone,student_name:me.name,rating:+document.getElementById("fr").value,taste:document.getElementById("ft").value,quality:document.getElementById("fq").value,quantity:document.getElementById("fn").value,suggestion:document.getElementById("fs").value}),"Couldn't submit feedback");
 if(!r)return;
 closeModal();toast("Thank you for your feedback");
}
function complaintModal(){modal(`<h2>📝 Complaint / Request</h2><textarea class=input id=cp placeholder="Write your complaint or request..."></textarea><button class=btn onclick="sendComplaint()">Submit</button>`)}
async function sendComplaint(){
 let x=document.getElementById("cp").value.trim();if(!x)return;
 const r=await safeCall(sb.from("complaints").insert({student_phone:me.phone,student_name:me.name,text:x,status:"Pending"}),"Couldn't submit complaint");
 if(!r)return;
 closeModal();toast("Complaint submitted");
}
async function activeNotices(){
 const cutoff=new Date(Date.now()-7*86400000).toISOString();
 const r=await safeCall(sb.from("notices").select("*").gte("created_at",cutoff).order("created_at",{ascending:false}),"Couldn't load notices");
 return r?.data||[];
}
async function noticesModal(){
 const r=await safeCall(sb.from("notices").select("*").order("created_at",{ascending:false}).limit(30),"Couldn't load notices");
 const all=r?.data||[];
 modal(`<h2>📢 All Notices</h2>${all.length?all.map(n=>`<div class="meal"><div>${esc(n.text)}</div><div class="sub">${new Date(n.created_at).toLocaleString()}</div></div>`).join(""):"<p class=muted>No notices yet.</p>"}`);
}

/* ============================ ADMIN ============================ */
async function mealCounts(meal){
 const totalR=await safeCall(sb.from("students").select("*",{count:"exact",head:true}).eq("active",true),"Couldn't count students");
 const total=totalR?.count||0;
 const mr=await safeCall(sb.from("meal_records").select("student_phone").eq("meal_date",today()).eq("meal",meal).eq("skipped",true),"Couldn't load skips");
 const skippedPhones=new Set((mr?.data||[]).map(r=>r.student_phone));
 const lv=await safeCall(sb.from("leaves").select("student_phone").lte("from_date",today()).gte("to_date",today()),"Couldn't load leaves");
 (lv?.data||[]).forEach(l=>skippedPhones.add(l.student_phone));
 const skipped=skippedPhones.size, present=Math.max(0,total-skipped);
 return {total,present,skipped,prepare:present};
}
async function sickCount(meal){
 const r=await safeCall(sb.from("meal_records").select("student_phone",{count:"exact",head:true}).eq("meal_date",today()).eq("meal",meal).eq("sick_light_diet",true),"Couldn't load light diet requests");
 return r?.count||0;
}
async function admin(){
 loading("Loading admin dashboard...");
 const mealsArr=["Breakfast","Lunch","Snack","Dinner"];
 const counts=await Promise.all(mealsArr.map(m=>mealCounts(m)));
 const sicks=await Promise.all(mealsArr.map(m=>sickCount(m)));
 const activeGirls=await safeCall(sb.from("students").select("*",{count:"exact",head:true}).eq("active",true),"");
 const pendingPay=await safeCall(sb.from("students").select("*",{count:"exact",head:true}).neq("payment","Received"),"");
 const newOrders=await safeCall(sb.from("orders").select("*",{count:"exact",head:true}).eq("status","New"),"");
 const complaintsAll=await safeCall(sb.from("complaints").select("*").order("created_at",{ascending:false}),"Couldn't load complaints");
 const complaints=complaintsAll?.data||[];
 const pendingComplaints=complaints.filter(c=>c.status!=="Solved").length;
 const feedbackR=await safeCall(sb.from("feedback").select("*").order("created_at",{ascending:false}).limit(4),"");
 const feedback=feedbackR?.data||[];
 const ordersR=await safeCall(sb.from("orders").select("*").order("created_at",{ascending:false}).limit(30),"Couldn't load orders");
 const orders=ordersR?.data||[];
 document.getElementById("app").innerHTML=`<div class="top"><div><div class=brand>🌸 Shri Ji Mess</div><div class=sub>Admin Panel</div></div><button class="btn small secondary" onclick="staffHome()">Switch Panel</button></div>
 <div class=adminTop><button class="tab on" onclick="admin()">Dashboard</button><button class=tab onclick="studentsAdmin()">Students</button><button class=tab onclick="productsAdmin()">Café</button><button class=tab onclick="settingsAdmin()">Settings</button></div><div class=page>
 <div class=card><h2>Today's Meals</h2>${mealsArr.map((m,i)=>{let c=counts[i],sc=sicks[i];return `<div class=meal><div class=row><b>${m}</b><b>Prepare: ${c.prepare}${sc?` <span class=sub>(🤒 ${sc})</span>`:""}</b></div><div class=sub>Total ${c.total} • Present ${c.present} • Skipped ${c.skipped}</div></div>`}).join("")}</div>
 <div class=grid><div class=card><b>🩺 Active Students</b><h2>${activeGirls?.count||0}</h2></div><div class=card><b>💳 Pending Payments</b><h2>${pendingPay?.count||0}</h2></div><div class=card><b>🛒 New Orders</b><h2>${newOrders?.count||0}</h2></div><div class=card><b>📝 Complaints</b><h2>${pendingComplaints}</h2></div></div>
 <div class=card><h3>☕ Café Orders</h3>${orders.map(o=>`<div class=meal><div class=row><b>#${o.id}</b><span class=pill>${o.status}</span></div><div class=sub>${esc(o.student_name)} • Room ${esc(o.room)}${o.student_phone?` • <a href="tel:${esc(o.student_phone)}">📞 ${esc(o.student_phone)}</a>`:""} • ₹${o.total}</div><div class=row style="margin-top:6px"><span class=sub>Payment: ${esc(o.payment||"Pending")}</span>${o.payment!=="Received"?`<button class="btn small" onclick="markOrderPaid('${o.id}')">Mark Payment Received</button>`:""}</div></div>`).join("")||"<p class=muted>No orders yet.</p>"}</div>
 <div class=card><h3>Recent Feedback</h3>${feedback.map(f=>`<p>⭐ ${f.rating}/5 — ${esc(f.taste||"No taste comment")} <span class=sub>(${esc(f.student_name||"")})</span></p>`).join("")||"<p class=muted>No feedback yet.</p>"}</div>
 <div class=card><h3>📢 Notices</h3><input class=input id=notice placeholder="New announcement"><button class=btn onclick="addNotice()">Post Notice</button></div>
 <div class=card><h3>📝 Complaints</h3>${complaints.map(c=>`<div class=meal><b>${esc(c.student_name)}</b>${c.student_phone?` <a href="tel:${esc(c.student_phone)}">📞 ${esc(c.student_phone)}</a>`:""}<p>${esc(c.text)}</p><span class=pill>${c.status}</span><button class="btn small" style="float:right" onclick="cycleComplaint(${c.id},'${c.status}')">Update</button></div>`).join("")||"<p class=muted>None</p>"}</div>
 </div>`
}
async function markOrderPaid(id){await safeCall(sb.from("orders").update({payment:"Received"}).eq("id",id),"Couldn't update");toast("Payment marked received");admin()}
async function addNotice(){let n=document.getElementById("notice").value.trim();if(!n)return;const r=await safeCall(sb.from("notices").insert({text:n}),"Couldn't post notice");if(!r)return;toast("Notice posted");admin()}
async function cycleComplaint(id,status){const next=status=="Pending"?"In Progress":status=="In Progress"?"Solved":"Pending";await safeCall(sb.from("complaints").update({status:next}).eq("id",id),"Couldn't update");admin()}

async function studentsAdmin(){
 loading("Loading students...");
 const r=await safeCall(sb.from("students").select("*").order("created_at",{ascending:false}),"Couldn't load students");
 const list=r?.data||[];
 document.getElementById("app").innerHTML=`<div class=top><div><div class=brand>🌸 Students</div><div class=sub>${list.length} registered</div></div><button class="btn small secondary" onclick="admin()">Back</button></div><div class=page>
 <div class=card><b>➕ Add New Student</b><br><button class="btn" style="margin-top:8px" onclick="addStudentModal()">Add Student Manually</button></div>
 <input class=input id=studentSearch placeholder="🔍 Search by name, room, or phone" oninput="filterStudentsList()">
 <div id="studentsList">
 ${list.map(s=>`<div class="card student-row" data-search="${esc((s.name+" "+(s.room||"")+" "+(s.phone||"")).toLowerCase())}"><div class=row><div><b>${esc(s.name)}</b><div class=sub>Room ${esc(s.room||"-")} • Batch ${esc(s.batch||"-")}</div>${s.phone?`<a href="tel:${esc(s.phone)}">📞 ${esc(s.phone)}</a>`:""}${s.active===false?` <span class="pill" style="background:#fee2e2;color:#b91c1c">Inactive</span>`:""}</div><div style="text-align:right"><span class=pill>${esc(s.payment)}</span><br><button class="btn small" style="margin-top:6px" onclick="studentDetail('${s.id}')">Manage</button></div></div></div>`).join("")||"<p class=muted>No students yet.</p>"}
 </div></div>`
}
function filterStudentsList(){
 const q=document.getElementById("studentSearch").value.trim().toLowerCase();
 document.querySelectorAll(".student-row").forEach(el=>{
   el.style.display=el.dataset.search.includes(q)?"":"none";
 });
}
function addStudentModal(){
 modal(`<h2>➕ Add New Student</h2><label class=label>Name</label><input class=input id=asn placeholder="Full name"><label class=label>Phone Number</label><input class=input id=asph type=tel maxlength=10 placeholder="10-digit mobile number"><label class=label>Batch</label><input class=input id=asb placeholder="2026"><label class=label>Room No.</label><input class=input id=asr placeholder="A-104"><label class=label>Plan</label><select class=input id=aspl><option value="">No plan yet</option><option>Monthly</option><option>Daily</option></select><label class=label>Amount</label><input class=input id=asam type=number value="0"><button class=btn onclick="addStudentSave()">Add Student</button>`)}
async function addStudentSave(){
 const n=document.getElementById("asn").value.trim(),ph=document.getElementById("asph").value.replace(/\D/g,""),b=document.getElementById("asb").value.trim(),r=document.getElementById("asr").value.trim(),pl=document.getElementById("aspl").value,am=+document.getElementById("asam").value||0;
 if(!n||!ph){toast("Naam aur phone zaroori hai");return}
 if(ph.length!==10){toast("10-digit phone number daalein");return}
 const res=await safeCall(sb.from("students").insert({name:n,phone:ph,batch:b,room:r,plan:pl,amount:am,payment:"Pending"}),"Couldn't add student — phone number pehle se ho sakta hai");
 if(!res)return;
 closeModal();toast("Student added");studentsAdmin();
}
async function studentDetail(id){
 loading("Loading student...");
 const r=await safeCall(sb.from("students").select("*").eq("id",id).single(),"Couldn't load student");
 const s=r?.data; if(!s){studentsAdmin();return}
 const records=await safeCall(sb.from("meal_records").select("*").eq("student_phone",s.phone).eq("meal_date",today()),"");
 const recs=records?.data||[];
 const leave=await safeCall(sb.from("leaves").select("*").eq("student_phone",s.phone).lte("from_date",today()).gte("to_date",today()),"");
 const onLeave=(leave?.data||[])[0]||null;
 const mealLine=["Breakfast","Lunch","Snack","Dinner"].map(m=>`${m} ${statusFrom(recs,onLeave,m)}`).join(", ");
 document.getElementById("app").innerHTML=`<div class=top><div><div class=brand>🌸 ${esc(s.name)}</div><div class=sub>Student Management</div></div><button class="btn small secondary" onclick="studentsAdmin()">Back</button></div><div class=page>
 <div class=card>
 <label class=label>Name</label><input class=input id=sname value="${esc(s.name)}">
 <label class=label>Phone Number</label><input class=input id=sphone type=tel maxlength=10 value="${esc(s.phone||"")}">
 <div class=row style="margin:8px 0">${s.phone?`<a class="btn small secondary" href="tel:${esc(s.phone)}">📞 Call</a>`:""}${s.phone?`<a class="btn small secondary" href="https://wa.me/91${esc(s.phone)}" target="_blank">💬 WhatsApp Message</a>`:""}</div>
 <label class=label>Batch</label><input class=input id=sbatch value="${esc(s.batch||"")}">
 <label class=label>Room No.</label><input class=input id=sroom value="${esc(s.room||"")}">
 <label class=label>Allergy / Dietary Note</label><input class=input id=aln value="${esc(s.allergy_note||"")}">
 <label class=label>Plan</label><select class=input id=splan><option value="" ${!s.plan?"selected":""}>No plan</option><option ${s.plan=="Monthly"?"selected":""}>Monthly</option><option ${s.plan=="Daily"?"selected":""}>Daily</option></select>
 <label class=label>Plan Amount</label><input class=input type=number id=pa value="${s.amount}">
 <label class=label>Start Date</label><input class=input type=date id=ps value="${s.start_date||""}">
 <label class=label>End Date</label><input class=input type=date id=pe value="${s.end_date||""}">
 <label class=label>Payment</label><select class=input id=pp><option ${s.payment=="Received"?"selected":""}>Received</option><option ${s.payment=="Pending"?"selected":""}>Pending</option><option ${s.payment=="Screenshot Sent / Pending Verification"?"selected":""}>Screenshot Sent / Pending Verification</option></select>
 <label class=label>Active Student?</label><select class=input id=sactive><option value="true" ${s.active!==false?"selected":""}>Active</option><option value="false" ${s.active===false?"selected":""}>Inactive (left mess)</option></select>
 <button class=btn onclick="saveStudentAdmin('${s.id}')">Save Student</button>
 <button class="btn danger" style="margin-top:8px" onclick="deleteStudentAdmin('${s.id}','${esc(s.name)}')">🗑️ Delete Student</button>
 </div>
 <div class=card><h3>Meal History</h3><p class=muted>Today: ${mealLine}</p></div></div>`
}
async function saveStudentAdmin(id){
 let amt=+document.getElementById("pa").value;if(isNaN(amt)||amt<0){toast("Enter a valid amount");return}
 const ph=document.getElementById("sphone").value.replace(/\D/g,"");
 if(ph.length!==10){toast("Enter a valid 10-digit phone number");return}
 const r=await safeCall(sb.from("students").update({
   name:document.getElementById("sname").value.trim(),
   phone:ph,
   batch:document.getElementById("sbatch").value.trim(),
   room:document.getElementById("sroom").value.trim(),
   plan:document.getElementById("splan").value,
   amount:amt,
   start_date:document.getElementById("ps").value||null,
   end_date:document.getElementById("pe").value||null,
   payment:document.getElementById("pp").value,
   allergy_note:document.getElementById("aln").value,
   active:document.getElementById("sactive").value==="true"
 }).eq("id",id),"Couldn't save student");
 if(!r)return;
 toast("Student updated");studentDetail(id);
}
async function deleteStudentAdmin(id,name){
 if(!confirm("Pakka "+name+" ko permanently delete karna hai? Ye undo nahi ho sakta."))return;
 const r=await safeCall(sb.from("students").delete().eq("id",id),"Couldn't delete student");
 if(!r)return;
 toast("Student deleted");studentsAdmin();
}
async function productsAdmin(){
 loading("Loading café products...");
 const r=await safeCall(sb.from("products").select("*").order("id"),"Couldn't load products");
 products=r?.data||[];
 document.getElementById("app").innerHTML=`<div class=top><div><div class=brand>☕ Café Products</div><div class=sub>Manage menu</div></div><button class="btn small secondary" onclick="admin()">Back</button></div><div class=page><div class=card><input class=input id=pnm placeholder="Product name"><input class=input id=ppr type=number placeholder="Price"><button class=btn onclick="addProduct()">Add Product</button></div>${products.map(p=>`<div class=card><div class=row><div><b>${p.emoji} ${esc(p.name)}</b><div>₹${p.price} • ${p.available?"Available":"Sold Out"}</div></div><button class="btn small ${p.available?"danger":"green"}" onclick="toggleProduct(${p.id})">${p.available?"Sold Out":"Available"}</button></div></div>`).join("")}</div>`
}
async function addProduct(){
 let n=document.getElementById("pnm").value.trim(),p=+document.getElementById("ppr").value;
 if(!n||!(p>0)){toast("Enter valid name & price");return}
 const r=await safeCall(sb.from("products").insert({name:n,price:p,emoji:"🍽️",available:true}),"Couldn't add product");
 if(!r)return;
 productsAdmin();
}
async function toggleProduct(id){
 const p=products.find(x=>x.id==id);
 const r=await safeCall(sb.from("products").update({available:!p.available}).eq("id",id),"Couldn't update product");
 if(!r)return;
 productsAdmin();
}
async function settingsAdmin(){
 loading("Loading settings...");
 const pollsR=await safeCall(sb.from("polls").select("*").order("day"),"Couldn't load polls");
 const polls=pollsR?.data||[];
 document.getElementById("app").innerHTML=`<div class=top><div><div class=brand>⚙️ Settings</div><div class=sub>Payment & Meal Timings</div></div><button class="btn small secondary" onclick="admin()">Back</button></div><div class=page><div class=card><h3>🔐 Staff PINs</h3><label class=label>Admin PIN</label><input class=input id=apin value="${esc(settings.admin_pin||"")}"><label class=label>Kitchen PIN</label><input class=input id=kpin value="${esc(settings.kitchen_pin||"")}"><button class=btn onclick="savePins()">Save PINs</button></div><div class=card><h3>Payment Settings</h3><label class=label>WhatsApp Number</label><input class=input id=wa value="${esc(settings.whatsapp||"")}"><label class=label>UPI QR</label><input class=input type=file accept="image/*" onchange="qrFile(this)"><div class=muted>Uploaded image is stored (as a QR image) in Settings for everyone to see.</div><button class=btn onclick="saveSettings()">Save Payment Settings</button></div><div class=card><h3>Meal Timings</h3>${Object.keys(settings.meal_times).map(m=>`<label class=label>${m}</label><input class=input type=time id="tm${m}" value="${settings.meal_times[m]}">`).join("")}<p class=muted>Skip Window = exactly 1 hour before meal time.</p><button class=btn onclick="saveTimes()">Save Timings</button></div>
 <div class=card><h3>🗳️ Poll Options</h3><p class=muted>Set tomorrow's poll options a day before. If you don't update, last week's options stay active automatically.</p>${polls.map(p=>`<div style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px"><b>${p.day} → ${p.meal}</b><label class=label>Question</label><input class=input id="pq_${p.day}" value="${esc(p.question)}"><label class=label>Options (comma separated)</label><input class=input id="po_${p.day}" value="${esc(p.options.join(", "))}"><button class="btn small" onclick="savePollOptions('${p.day}')">Save ${p.day} Poll</button></div>`).join("")}</div>
 </div>`
}
async function savePollOptions(d){
 let q=document.getElementById("pq_"+d).value.trim();
 let opts=document.getElementById("po_"+d).value.split(",").map(x=>x.trim()).filter(Boolean);
 if(!q||opts.length<2){toast("Question + at least 2 options chahiye");return}
 const r=await safeCall(sb.from("polls").update({question:q,options:opts}).eq("day",d),"Couldn't save poll");
 if(!r)return;
 await safeCall(sb.from("poll_votes").delete().eq("poll_day",d).eq("vote_date",today()),"");
 toast(d+" poll updated, votes reset");settingsAdmin();
}
function qrFile(input){
 let f=input.files[0];if(!f)return;let r=new FileReader();
 r.onload=async()=>{
   const res=await safeCall(sb.from("settings").update({qr_url:r.result}).eq("id",1),"Couldn't upload QR");
   if(!res)return;
   settings.qr_url=r.result;toast("QR uploaded");
 };
 r.readAsDataURL(f);
}
async function savePins(){
 const ap=document.getElementById("apin").value.trim(), kp=document.getElementById("kpin").value.trim();
 if(!ap||!kp){toast("PIN khali nahi ho sakta");return}
 const r=await safeCall(sb.from("settings").update({admin_pin:ap,kitchen_pin:kp}).eq("id",1),"Couldn't save PINs");
 if(!r)return;
 settings.admin_pin=ap;settings.kitchen_pin=kp;
 toast("PINs updated");
}
async function saveSettings(){
 const wa=document.getElementById("wa").value.replace(/\D/g,"");
 const r=await safeCall(sb.from("settings").update({whatsapp:wa}).eq("id",1),"Couldn't save settings");
 if(!r)return;
 settings.whatsapp=wa;toast("Payment settings saved");
}
async function saveTimes(){
 let mt={};for(let m of Object.keys(settings.meal_times))mt[m]=document.getElementById("tm"+m).value;
 const r=await safeCall(sb.from("settings").update({meal_times:mt}).eq("id",1),"Couldn't save timings");
 if(!r)return;
 settings.meal_times=mt;toast("Meal timings saved");settingsAdmin();
}

/* ============================ KITCHEN ============================ */
let audioCtx=null, sirenTimer=null;
function unlockAudio(){
 try{
   if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
   if(audioCtx.state==="suspended")audioCtx.resume();
   toast("🔊 Sound alerts enabled");
   kitchen();
 }catch(err){toast("Is device par sound support nahi hai")}
}
function playSirenOnce(){
 if(!audioCtx||audioCtx.state==="suspended")return;
 const t=audioCtx.currentTime;
 const o=audioCtx.createOscillator(),g=audioCtx.createGain();
 o.type="sine";o.connect(g);g.connect(audioCtx.destination);
 g.gain.value=0.25;
 o.frequency.setValueAtTime(600,t);
 o.frequency.linearRampToValueAtTime(1000,t+0.35);
 o.frequency.linearRampToValueAtTime(600,t+0.7);
 o.frequency.linearRampToValueAtTime(1000,t+1.05);
 o.frequency.linearRampToValueAtTime(600,t+1.4);
 o.start(t);o.stop(t+1.4);
}
function startSiren(){
 stopSiren();
 playSirenOnce();
 sirenTimer=setInterval(playSirenOnce,1600);
}
function stopSiren(){if(sirenTimer){clearInterval(sirenTimer);sirenTimer=null}const b=document.getElementById("orderAlertBanner");if(b)b.remove()}
function showOrderAlert(count){
 if(document.getElementById("orderAlertBanner"))return;
 const b=document.createElement("div");b.id="orderAlertBanner";
 b.style.cssText="position:fixed;top:0;left:0;right:0;z-index:999;background:#dc2626;color:#fff;padding:16px;text-align:center;font-weight:900;font-size:17px;box-shadow:0 4px 14px rgba(0,0,0,.3)";
 b.innerHTML=`🚨 ${count} New Order${count>1?"s":""} Aa Gaya! <button style="margin-left:12px;background:#fff;color:#dc2626;border:none;border-radius:8px;padding:6px 14px;font-weight:900" onclick="stopSiren()">Dismiss</button>`;
 document.body.appendChild(b);
}
function stopKitchenWatch(){if(kitchenTimer){clearInterval(kitchenTimer);kitchenTimer=null}}
function watchKitchenOrders(currentIds){
 stopKitchenWatch();
 kitchenSeenIds=new Set(currentIds);
 kitchenTimer=setInterval(async()=>{
   const r=await sb.from("orders").select("id").order("created_at",{ascending:false}).limit(30);
   if(r.error||!r.data)return;
   const freshIds=r.data.map(o=>o.id);
   const newOnes=freshIds.filter(id=>!kitchenSeenIds.has(id));
   if(newOnes.length){
     kitchenSeenIds=new Set(freshIds);
     startSiren();showOrderAlert(newOnes.length);
     kitchen();
   }
 },5000);
}
let wakeLock=null;
async function keepScreenAwake(){
 try{
   if("wakeLock" in navigator){wakeLock=await navigator.wakeLock.request("screen")}
 }catch(err){}
}
document.addEventListener("visibilitychange",async()=>{
 if(document.visibilityState==="visible"&&document.body.className==="kitchen")await keepScreenAwake();
});
async function kitchen(){
 loading("Loading kitchen panel...");
 document.body.className="kitchen";
 await keepScreenAwake();
 const p=await loadKitchenPoll();
 const mealsArr=["Breakfast","Lunch","Snack","Dinner"];
 const counts=await Promise.all(mealsArr.map(m=>mealCounts(m)));
 const ordersR=await safeCall(sb.from("orders").select("*").order("created_at",{ascending:false}).limit(40),"Couldn't load orders");
 const orders=ordersR?.data||[];
 watchKitchenOrders(orders.map(o=>o.id));
 const audioReady=audioCtx&&audioCtx.state!=="suspended";
 document.getElementById("app").innerHTML=`<div class=top><div><div class=brand>🌸 Shri Ji Mess</div><div class=sub>Kitchen Panel</div></div><button class="btn small secondary" onclick="if(wakeLock){wakeLock.release();wakeLock=null}stopSiren();stopKitchenWatch();document.body.className='';staffHome()">Exit</button></div><div class=page>
 ${!audioReady?`<div class="card" style="background:#fff7e6;text-align:center"><b>🔔 Naye order ka siren alert sunne ke liye (jab tab khula ho)</b><br><button class="btn" style="margin-top:10px" onclick="unlockAudio()">🔊 Enable Sound Alerts</button></div>`:""}
 <div class="card" style="background:#eefdf3;text-align:center"><b>📱 Screen band/app minimize hone par bhi alert chahiye?</b><br><button class="btn green" style="margin-top:10px" onclick="enablePush()">🔔 Enable Push Notifications</button></div>
 ${p?`<div class=card><h3>🗳️ ${p.meal} Poll Result</h3>${p.winner?`<h1 style="margin:4px 0">${esc(p.winner.name)}</h1><div class=sub>${p.winner.votes} vote${p.winner.votes>1?"s":""} so far</div>`:`<p class=muted>No votes yet</p>`}</div>`:""}
 <h2>🍽️ Today's Preparation</h2>${mealsArr.map((m,i)=>{let c=counts[i];return `<div class=card><div class=row><div><div style="font-size:28px">${m=="Breakfast"?"🍳":m=="Lunch"?"🍛":m=="Snack"?"☕":"🌙"}</div><b>${m}</b></div><h1>${c.prepare}</h1></div><div class=sub>MEALS TO PREPARE</div></div>`}).join("")}
 <h2>☕ Café Orders</h2>${orders.map(o=>`<div class=card><div class=row><b>#${o.id}</b><span class=pill>${o.status}</span></div><p>${o.items.map(x=>esc(x[0])+" × "+x[1]).join("<br>")}</p><b>Room ${esc(o.room)}</b>${o.student_phone?`<div style="margin-top:4px"><a class="btn small secondary" href="tel:${esc(o.student_phone)}">📞 Call ${esc(o.student_phone)}</a></div>`:""}<div style="display:flex;gap:7px;margin-top:10px"><button class="btn small" onclick="orderStatus('${o.id}','Preparing')">PREPARING</button><button class="btn small green" onclick="orderStatus('${o.id}','Ready for Pickup')">READY</button><button class="btn small secondary" onclick="orderStatus('${o.id}','Completed')">COMPLETED</button></div></div>`).join("")}</div>`
}
async function loadKitchenPoll(){
 const d=dayName();
 const r=await safeCall(sb.from("polls").select("*").eq("day",d).maybeSingle(),"");
 const p=r?.data; if(!p)return null;
 const votesR=await safeCall(sb.from("poll_votes").select("option_index").eq("poll_day",d).eq("vote_date",today()),"");
 const votes=votesR?.data||[];
 if(!votes.length)return {...p,winner:null};
 const tallies=p.options.map((_,i)=>votes.filter(v=>v.option_index===i).length);
 const maxV=Math.max(...tallies), idx=tallies.indexOf(maxV);
 return {...p,winner:{name:p.options[idx],votes:maxV}};
}
async function orderStatus(id,s){await safeCall(sb.from("orders").update({status:s}).eq("id",id),"Couldn't update order");kitchen()}


/* Staff dashboard styling now lives in style.css (single source of truth —
   no more duplicate JS-injected stylesheet fighting the main one). */

function sjmStaffHeader(active){
  const tabs=[["overview","📊 Overview"],["kitchen","🍽️ Kitchen"],["students","🩺 Students"],["cafe","☕ Café"],["payments","💳 Payments"],["poll","🗳️ Poll"],["settings","⚙️ Settings"]];
  return `<div class="top"><div><div class="brand">🩺 Shri Ji Mess</div><div class="sub">Doctor Hostel • Staff Dashboard</div></div><span class="pill">STAFF</span></div>
  <div class="page"><div class="sjm-tabs">${tabs.map(t=>`<button class="sjm-tab ${active===t[0]?"on":""}" onclick="sjmStaffGo('${t[0]}')">${t[1]}</button>`).join("")}</div>`;
}

function sjmStaffGo(tab){
  if(tab==="students"){studentsAdmin();return}
  if(tab==="cafe"){productsAdmin();return}
  if(tab==="settings"){settingsAdmin();return}
  if(tab==="kitchen"){kitchen();return}
  if(tab==="payments"){staffDashboard("payments");return}
  if(tab==="poll"){staffDashboard("poll");return}
  staffDashboard("overview");
}

function staffHome(){
  document.getElementById("app").innerHTML=`<div class="page" style="padding-top:42px">
    <div class="sjm-hero"><div style="font-size:44px">🩺</div><h1>Shri Ji Mess</h1><p>Doctor Hostel • Staff Dashboard</p></div>
    <div class="card"><h2 style="margin-top:0">Welcome back 👋</h2><p class="muted">All operations are now in one place — kitchen, café, students, payments and menu.</p>
    <button class="btn" style="width:100%;margin-top:10px" onclick="requireRole('staff',staffDashboard)">Open Staff Dashboard</button></div>
  </div>`;
}

function requireRole(role,cb){
  const key="sjmStaffOk";
  if(sessionStorage.getItem(key)==="1"){cb("overview");return}
  const expected=String(settings.staff_pin||settings.admin_pin||settings.kitchen_pin||"1234");
  const pin=prompt("Enter Staff PIN");
  if(pin===null){staffHome();return}
  if(String(pin)===expected){sessionStorage.setItem(key,"1");cb("overview")}
  else{toast("❌ Galat Staff PIN");staffHome()}
}

async function staffDashboard(section="overview"){
  loading("Loading Staff Dashboard...");
  document.body.className="";
  const mealsArr=["Breakfast","Lunch","Snack","Dinner"];
  const [counts,sicks,activeStudents,pendingPay,newOrders,complaintsR,feedbackR,ordersR]=await Promise.all([
    Promise.all(mealsArr.map(m=>mealCounts(m))),
    Promise.all(mealsArr.map(m=>sickCount(m))),
    safeCall(sb.from("students").select("*",{count:"exact",head:true}).eq("active",true),""),
    safeCall(sb.from("students").select("*",{count:"exact",head:true}).neq("payment","Received"),""),
    safeCall(sb.from("orders").select("*",{count:"exact",head:true}).eq("status","New"),""),
    safeCall(sb.from("complaints").select("*").order("created_at",{ascending:false}),"Couldn't load complaints"),
    safeCall(sb.from("feedback").select("*").order("created_at",{ascending:false}).limit(4),""),
    safeCall(sb.from("orders").select("*").order("created_at",{ascending:false}).limit(25),"Couldn't load orders")
  ]);
  const complaints=complaintsR?.data||[], feedback=feedbackR?.data||[], orders=ordersR?.data||[];
  const pendingComplaints=complaints.filter(c=>c.status!=="Solved").length;
  const totalPrepare=counts.reduce((a,c)=>a+(c.prepare||0),0);
  const focus=section==="kitchen"?"kitchen":section;

  let html=sjmStaffHeader(focus);
  html+=`<div class="sjm-hero"><div class="eyebrow">Staff dashboard</div>
    <h1>Everything in one place.</h1><p>Kitchen, café, students and payments — simple, fast, clear.</p></div>`;

  html+=`<div class="sjm-grid">
    <div class="card sjm-stat"><span class="muted">🍽️ Meals to prepare</span><strong>${totalPrepare}</strong></div>
    <div class="card sjm-stat"><span class="muted">🩺 Active students</span><strong>${activeStudents?.count||0}</strong></div>
    <div class="card sjm-stat"><span class="muted">🛒 New café orders</span><strong>${newOrders?.count||0}</strong></div>
    <div class="card sjm-stat"><span class="muted">💳 Pending payments</span><strong>${pendingPay?.count||0}</strong></div>
  </div>`;

  html+=`<div class="sjm-grid" style="margin-top:12px">
    <button class="card sjm-action" onclick="staffDashboard('kitchen')"><span class="sjm-icon">🍽️</span><span><b>Kitchen</b><br><span class="muted">Preparation + live orders</span></span></button>
    <button class="card sjm-action" onclick="studentsAdmin()"><span class="sjm-icon">🩺</span><span><b>Students</b><br><span class="muted">Manage residents</span></span></button>
    <button class="card sjm-action" onclick="productsAdmin()"><span class="sjm-icon">☕</span><span><b>Café</b><br><span class="muted">Menu + products</span></span></button>
    <button class="card sjm-action" onclick="staffDashboard('payments')"><span class="sjm-icon">💳</span><span><b>Payments</b><br><span class="muted">Pending verification</span></span></button>
  </div>`;

  if(focus==="kitchen"){
    html+=`<div class="card" style="margin-top:14px"><h2 style="margin-top:0">Today's Kitchen</h2>`;
    html+=mealsArr.map((m,i)=>{const c=counts[i],sc=sicks[i];return `<div class="meal sjm-kitchen-card"><div class="row"><div><b>${m}</b><div class="sub">Total ${c.total} • Present ${c.present} • Skipped ${c.skipped}</div></div><div class="sjm-number">${c.prepare}</div></div>${sc?`<div class="sub">🤒 ${sc} light-diet request${sc>1?"s":""}</div>`:""}</div>`}).join("");
    html+=`</div><div class="card"><h2 style="margin-top:0">☕ Live Café Orders</h2>`;
    html+=orders.map(o=>`<div class="meal"><div class="row"><b>#${o.id}</b><span class="pill">${esc(o.status)}</span></div><div class="sub">${esc(o.student_name)} • Room ${esc(o.room)} • ₹${o.total}</div><p>${(o.items||[]).map(x=>esc(x[0])+" × "+x[1]).join("<br>")}</p><div style="display:flex;gap:7px;flex-wrap:wrap"><button class="btn small" onclick="orderStatus('${o.id}','Preparing')">PREPARING</button><button class="btn small green" onclick="orderStatus('${o.id}','Ready for Pickup')">READY</button><button class="btn small secondary" onclick="orderStatus('${o.id}','Completed')">COMPLETED</button></div></div>`).join("")||`<p class="muted">No café orders.</p>`;
    html+=`</div>`;
  } else if(focus==="payments"){
    html+=`<div class="card" style="margin-top:14px"><h2 style="margin-top:0">💳 Payment Queue</h2><p class="muted">${pendingPay?.count||0} students need payment verification.</p><button class="btn" onclick="studentsAdmin()">Open Students →</button></div>`;
  } else if(focus==="poll"){
    const p=await loadKitchenPoll();
    html+=`<div class="card" style="margin-top:14px"><h2 style="margin-top:0">🗳️ Today's Poll</h2>${p?.winner?`<div class="sjm-hero" style="margin:10px 0"><div class="muted" style="color:#c8d2e4">Current winner</div><h1>${esc(p.winner.name)}</h1><p>${p.winner.votes} vote${p.winner.votes>1?"s":""} so far</p></div>`:`<p class="muted">No votes yet.</p>`}</div>`;
  } else {
    html+=`<div class="card" style="margin-top:14px"><h2 style="margin-top:0">Today's Meals</h2>${mealsArr.map((m,i)=>{const c=counts[i],sc=sicks[i];return `<div class="meal"><div class="row"><b>${m}</b><b>${c.prepare} to prepare</b></div><div class="sub">Present ${c.present} • Skipped ${c.skipped}${sc?` • 🤒 Light ${sc}`:""}</div></div>`}).join("")}</div>`;
    html+=`<div class="card"><h2 style="margin-top:0">☕ Recent Café Orders</h2>${orders.slice(0,8).map(o=>`<div class="meal"><div class="row"><b>#${o.id}</b><span class="pill">${esc(o.status)}</span></div><div class="sub">${esc(o.student_name)} • Room ${esc(o.room)} • ₹${o.total}</div></div>`).join("")||`<p class="muted">No orders yet.</p>`}</div>`;
    html+=`<div class="card"><h3>📝 Open Complaints</h3><b>${pendingComplaints}</b><p class="muted">Use Students/management section to resolve them.</p></div>`;
  }
  html+=`</div>`;
  document.getElementById("app").innerHTML=html;
}

async function admin(){ return staffDashboard("overview"); }
// NOTE: kitchen() intentionally NOT redefined here — the original kitchen()
// defined above (with siren alerts, order banner, wake-lock and live order
// watch) is kept as the real kitchen panel.

boot();
