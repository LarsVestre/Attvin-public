(function(){
  const SC = document.currentScript;
  const CFG = {
    SUPABASE_URL:  SC?.dataset?.supaUrl  || "",
    SUPABASE_ANON: SC?.dataset?.supaAnon || "",
    PAGE_SIZE:     parseInt(SC?.dataset?.pageSize||"20",10)||20
  };

  const ENUMS = {
    review_status_enum: ["Under behandling","Trenger mer info","Godkjent","Avvist","Arkivert"],
    leveranse_type:     ["Enkeltleveranse","Jevnlig leveranse"],
    avfall_grad:        ["Ordinært avfall","Farleg avfall","Usikker"],
    forbehandling:      ["Ingen","Sorteringsanlegg","Biologisk behandling","Forbrenning","Oppmaling / kverning","Annet"],
    naeringskode_top:   ["Jordbruk, skogbruk og fiske","Bergverk og utvinning","Industri","Elektrisitet, gass, dam og varmtvannfors","Vannfors. Avløps og renovasjonvirksomhet","Bygge og anleggsvirksomhet","Tjenesteytende næring","Private husholdninger"],
    ja_nei:             ["Ja","Nei"],
    ja_nei_usikker:     ["Ja","Nei","Usikker"]
  };

  const NAERINGSKODE_MAP = {
    "Jordbruk, skogbruk og fiske": "1000",
    "Bergverk og utvinning": "2000",
    "Industri": "3000",
    "Elektrisitet, gass, dam og varmtvannfors": "4000",
    "Vannfors. Avløps og renovasjonvirksomhet": "5000",
    "Bygge og anleggsvirksomhet": "6000",
    "Tjenesteytende næring": "7000",
    "Private husholdninger": "8000"
  };

  /* ---------------- Utils ---------------- */
  const BK = window.BKCore || {};
  function ensureRoot(){
    let root = document.getElementById("att-admin-bk-root");
    if (!root){
      root = document.createElement("div");
      root.id = "att-admin-bk-root";
      SC.parentNode ? SC.parentNode.insertBefore(root, SC.nextSibling) : document.body.appendChild(root);
    }
    return root;
  }
  const esc = BK.esc || ((s)=> (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])));
  const fmtDate = (d)=>{ if(!d) return ""; const dt=new Date(d); return isNaN(+dt)?"":dt.toISOString().slice(0,10); };
  const fmtHuman = BK.fmtDateTime || ((d)=>{ if(!d) return "-"; const dt=new Date(d); return isNaN(+dt)?"-":dt.toLocaleString("no-NO"); });
  const safeLike=(s)=> (s||"").replace(/%/g,"").trim();
  const debounce = BK.debounce || ((fn,w=250)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),w); }; });
  const isUuid = (s)=> /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

  function buildSearchOr(query){
    const s = safeLike(query);
    if (!s) return "";
    const parts = [
      `avfallsprod_kundenavn.ilike.%${s}%`,
      `avfallsprod_orgnr.ilike.%${s}%`,
      `avfallsprod_avtalenr.ilike.%${s}%`,
      `prosjekt.ilike.%${s}%`,
      `avfall_velg_type.ilike.%${s}%`
    ];
    if (isUuid(s)) parts.push(`account_id.eq.${s}`);
    return parts.join(",");
  }

  function statusPill(status, big=false){
    const s = status||"Under behandling";
    let cls="pend", dot="s-pend";
    if (s==="Godkjent"){ cls="ok"; dot="s-ok"; }
    else if (s==="Trenger mer info"){ cls="mid"; dot="s-mid"; }
    else if (s==="Avvist"){ cls="bad"; dot="s-bad"; }
    else if (s==="Arkivert"){ cls="warn"; dot="s-warn"; }
    const style = big? 'style="font-size:14px;padding:8px 12px"' : '';
    return `<span class="att-pill att-status ${cls}" ${style}><span class="dot ${dot}"></span>${esc(s)}</span>`;
  }

  const COLUMN_DEFS = [
    { key: "kunde", label: "Kunde", render: (r)=> esc(r.avfallsprod_kundenavn || r.account_id || "-") },
    { key: "orgnr", label: "Org.nr", render: (r)=> esc(r.avfallsprod_orgnr || "-") },
    { key: "avtalenr", label: "Avtalenr", render: (r)=> esc(r.avfallsprod_avtalenr || "-") },
    { key: "prosjekt", label: "Prosjekt", render: (r)=> esc(r.prosjekt || "-") },
    { key: "avfallstype", label: "Avfallstype", render: (r)=> esc(r.avfall_velg_type || "-") },
    { key: "status", label: "Status", render: (r)=> statusPill(r.review_status) },
    { key: "periode", label: "Dato (fra–til)", render: (r)=> `${r.dato_fra?new Date(r.dato_fra).toLocaleDateString('no-NO'):'-'} – ${r.dato_til?new Date(r.dato_til).toLocaleDateString('no-NO'):'-'}` },
    { key: "oppdatert", label: "Oppdatert", render: (r)=> esc(fmtHuman(r.updated_at || r.created_at)) },
  ];
  const DEFAULT_COLUMNS = ["kunde","prosjekt","avfallstype","status","periode"];

  function loadColumnPrefs(){
    try{
      const raw = localStorage.getItem("att-bk-admin-columns");
      if (!raw) return DEFAULT_COLUMNS.slice();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULT_COLUMNS.slice();
      const allowed = new Set(COLUMN_DEFS.map(c=>c.key));
      const filtered = parsed.filter(k=>allowed.has(k));
      return filtered.length ? filtered : DEFAULT_COLUMNS.slice();
    }catch(_){
      return DEFAULT_COLUMNS.slice();
    }
  }

  function saveColumnPrefs(cols){
    try{
      localStorage.setItem("att-bk-admin-columns", JSON.stringify(cols));
    }catch(_){}
  }

  /* ---------------- Global API for Script 2 ---------------- */
  window.AttBKAdmin = window.AttBKAdmin || {};
  const API = window.AttBKAdmin;

  /* ---------------- State ---------------- */
  const S = {
    sb:null,
    me:null,
    isAdmin:false,
    page:1, pageSize:CFG.PAGE_SIZE, total:0,
    q:"",
    tab:"all",
    rows:[], loading:false, error:"",
    columns: loadColumnPrefs(),
    colMenuOpen:false,
    drawerOpen:false, current:null, saving:false,
    katalog:[], katByType:new Map(), katTypes:[],
    toast:"",
    // files
    files:[],
    filesLoading:false,
    filesError:"",
    uploading:false
    ,
    stats:{
      loading:false,
      error:"",
      total:0,
      approved:0,
      pending:0,
      needsInfo:0,
      rejected:0,
      archived:0,
      active:0,
      expiring:0,
      expired:0
    }
  };

  API.state = S;
  API.refreshList = ()=>silentFetchList();
  API.openDrawer = (id)=>openDrawer(id);
  API.closeDrawer = ()=>closeDrawer();
  API.getSupabase = ()=>S.sb;
  API.getCurrent = ()=>S.current;
  API.buildSearchOr = buildSearchOr;

  /* ---------------- Supabase client ---------------- */
  async function getSupabaseClient(){
    if (BK.getSupabaseClient) {
      const { sb, user } = await BK.getSupabaseClient({
        supabaseUrl: CFG.SUPABASE_URL,
        supabaseAnon: CFG.SUPABASE_ANON,
        requireSession: false,
      });
      if (user) {
        S.me = {
          email: user.email || null,
          name: user.user_metadata?.full_name || user.user_metadata?.name || null,
          sub: user.id || null,
        };
      }
      return sb;
    }

    if (!window.supabase?.createClient) {
      throw new Error("Supabase-klient mangler og BKCore er ikke lastet.");
    }
    return window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON);
  }

  /* ---------------- Katalog ---------------- */
  async function loadKatalog(){
    try{
      const { data, error } = await S.sb
        .from("basiskarakteriseringer_katalog")
        .select("type_navn, grad, eal, varekode, ns_kode, default_grad")
        .order("type_navn", { ascending:true });
      if (error) throw error;

      S.katalog = data||[];
      S.katByType.clear();
      const set = new Set();
      for (const r of S.katalog){
        if (!r?.type_navn) continue;
        set.add(r.type_navn);
        const arr = S.katByType.get(r.type_navn) || [];
        arr.push(r);
        S.katByType.set(r.type_navn, arr);
      }
      S.katTypes = Array.from(set).sort((a,b)=>a.localeCompare(b,'nb'));
    }catch(e){
      console.warn("[BK core] katalog fail:", e);
    }
  }

  function findKatalogMatch(typeNavn, grad){
    if (!typeNavn) return null;
    const list = S.katByType.get(typeNavn) || [];
    if (grad){
      const exact = list.find(x => (x.grad||null) === grad);
      if (exact) return exact;
    }
    const nullGrad = list.find(x => x.grad == null);
    return nullGrad || list[0] || null;
  }

  function applyCodesFromCatalog(payload){
    const hit = findKatalogMatch(payload.avfall_velg_type || "", payload.avfall_grad || null);
    if (!hit) return payload;
    return {
      ...payload,
      eal: hit.eal ?? null,
      varekode: hit.varekode ?? null,
      ns_kode: hit.ns_kode ?? null,
      avfall_grad: payload.avfall_grad ?? (hit.default_grad ?? null)
    };
  }

  /* ---------------- Files (list + admin upload) ---------------- */
  async function loadFilesForCurrent(){
    if (!S.current || !S.sb) return;
    S.filesLoading = true;
    S.filesError = "";
    render();
    try{
      const bkId = S.current.id;
      const { data, error } = await S.sb
        .from("bk_files")
        .select("id,storage_path,original_name,mime,size,created_at")
        .eq("bk_id", bkId)
        .order("created_at",{ascending:false});
      if (error) throw error;

      const files = data || [];
      let signed = [];
      if (files.length){
        const paths = files.map(f=>f.storage_path);
        const { data:urlData, error:urlErr } = await S.sb
          .storage
          .from("bk-files")
          .createSignedUrls(paths, 60*30);
        if (urlErr) throw urlErr;
        signed = urlData || [];
      }
      S.files = files.map((f,idx)=>({
        ...f,
        signed_url: signed[idx]?.signedUrl || null
      }));
    }catch(e){
      console.error("[BK core] loadFilesForCurrent error:", e);
      S.files = [];
      S.filesError = e.message || String(e);
    }finally{
      S.filesLoading = false;
      render();
    }
  }

  async function uploadAdminFiles(fileList){
    if (!S.current || !S.sb) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;

    S.uploading = true;
    S.filesError = "";
    render();

    try{
      for (const f of files){
        const safeName = (f.name || "vedlegg").replace(/[^\w.\-() ]+/g, "_");
        const path = `admin/${S.current.id}/${Date.now()}_${safeName}`;

        const { error: upErr } = await S.sb
          .storage
          .from("bk-files")
          .upload(path, f, { contentType: f.type || "application/octet-stream", upsert:false });
        if (upErr) throw upErr;

        const { error: insErr } = await S.sb
          .from("bk_files")
          .insert({
            bk_id: S.current.id,
            storage_path: path,
            original_name: f.name || safeName,
            mime: f.type || null,
            size: f.size || null
          });
        if (insErr) throw insErr;
      }
      await loadFilesForCurrent();
    }catch(e){
      console.error("[BK core] uploadAdminFiles error:", e);
      S.filesError = e.message || String(e);
    }finally{
      S.uploading = false;
      render();
    }
  }

  function filesHtml(){
    if (S.filesLoading) return `<div class="att-muted">Laster vedlegg…</div>`;
    if (S.filesError) return `<div class="att-error">Kunne ikke hente vedlegg<br><small>${esc(S.filesError)}</small></div>`;
    if (!S.files || !S.files.length) return `<div class="att-muted">Ingen vedlegg.</div>`;

    return `
      <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px">
        ${S.files.map(f=>`
          <li style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;border:1px solid #eef2f6;border-radius:12px;padding:10px">
            <div style="display:flex;flex-direction:column;gap:4px;min-width:260px">
              <strong style="font-size:14px">${esc(f.original_name||"vedlegg")}</strong>
              <div class="att-muted" style="font-size:12px">
                ${esc(f.mime||"")} ${f.size?(" • "+esc(String(f.size))+" B"):""} ${f.created_at?(" • "+esc(new Date(f.created_at).toLocaleString("no-NO"))):""}
              </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${f.signed_url ? `<a class="att-btn ghost" href="${esc(f.signed_url)}" target="_blank" rel="noopener">Åpne</a>` : ``}
            </div>
          </li>
        `).join("")}
      </ul>
    `;
  }

  /* ---------------- List fetch (silent, no focus loss) ---------------- */
  let _token = 0;
  async function silentFetchList(){
    if (!S.sb) return;
    const t = ++_token;

    // capture focus + caret
    const a = document.activeElement;
    const activeId = a?.id || null;
    const ss = a?.selectionStart, se=a?.selectionEnd;

    S.loading = true;
    render();

    try{
      let q = S.sb.from("basiskarakteriseringer")
        .select("id,avfallsprod_kundenavn,avfallsprod_orgnr,avfallsprod_avtalenr,prosjekt,avfall_velg_type,review_status,dato_fra,dato_til,created_at,updated_at,account_id", { count:"exact" })
        .order("created_at",{ascending:false})
        .range((S.page-1)*S.pageSize,(S.page*S.pageSize)-1);

      const searchOr = buildSearchOr(S.q);
      if (searchOr) q = q.or(searchOr);
      if (S.tab && S.tab !== "all") {
        const today = isoDate(0);
        const soon = isoDate(STATS_SOON_DAYS);
        if (S.tab.startsWith("status:")) {
          const statusVal = S.tab.slice("status:".length);
          q = q.eq("review_status", statusVal);
        } else if (S.tab === "approved") {
          q = q.eq("review_status", "Godkjent");
        } else if (S.tab === "active") {
          q = q.eq("review_status", "Godkjent")
               .or(`dato_til.is.null,dato_til.gte.${today}`);
        } else if (S.tab === "expiring") {
          q = q.eq("review_status", "Godkjent")
               .gte("dato_til", today)
               .lte("dato_til", soon);
        } else if (S.tab === "expired") {
          q = q.eq("review_status", "Godkjent")
               .lt("dato_til", today);
        }
      }

      const { data, error, count } = await q;
      if (error) throw error;
      if (t !== _token) return;

      S.rows = data||[];
      S.total = count||0;
      S.error = "";
      loadStats();

    }catch(e){
      S.error = e.message||String(e);
    }finally{
      S.loading = false;
      render();

      // restore focus
      if (activeId){
        const el = document.getElementById(activeId);
        if (el?.focus){
          el.focus();
          try{ if (typeof ss==="number") el.setSelectionRange(ss,se); }catch(_){}
        }
      }
    }
  }

  /* ---------------- Stats / overview ---------------- */
  let _statsToken = 0;
  const STATS_SOON_DAYS = 30;
  const isoDate = (offsetDays = 0) => {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0,10);
  };

  function withSearch(q){
    const searchOr = buildSearchOr(S.q);
    if (!searchOr) return q;
    return q.or(searchOr);
  }

  async function countRows(q){
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  }

  async function loadStats(){
    if (!S.sb) return;
    const t = ++_statsToken;
    S.stats.loading = true;
    S.stats.error = "";
    render();

    try{
      const today = isoDate(0);
      const soon = isoDate(STATS_SOON_DAYS);

      const baseCount = () =>
        withSearch(
          S.sb.from("basiskarakteriseringer").select("id", { count:"exact", head:true })
        );

      const totalQ = baseCount();
      const approvedQ = baseCount().eq("review_status","Godkjent");
      const pendingQ = baseCount().eq("review_status","Under behandling");
      const needsInfoQ = baseCount().eq("review_status","Trenger mer info");
      const rejectedQ = baseCount().eq("review_status","Avvist");
      const archivedQ = baseCount().eq("review_status","Arkivert");
      const activeQ = baseCount()
        .eq("review_status","Godkjent")
        .or(`dato_til.is.null,dato_til.gte.${today}`);
      const expiringQ = baseCount()
        .eq("review_status","Godkjent")
        .gte("dato_til", today)
        .lte("dato_til", soon);
      const expiredQ = baseCount()
        .eq("review_status","Godkjent")
        .lt("dato_til", today);

      const [
        total, approved, pending, needsInfo, rejected, archived, active, expiring, expired
      ] = await Promise.all([
        countRows(totalQ),
        countRows(approvedQ),
        countRows(pendingQ),
        countRows(needsInfoQ),
        countRows(rejectedQ),
        countRows(archivedQ),
        countRows(activeQ),
        countRows(expiringQ),
        countRows(expiredQ),
      ]);

      if (t !== _statsToken) return;
      S.stats = {
        ...S.stats,
        loading:false,
        error:"",
        total,
        approved,
        pending,
        needsInfo,
        rejected,
        archived,
        active,
        expiring,
        expired
      };
    }catch(e){
      if (t !== _statsToken) return;
      S.stats.loading = false;
      S.stats.error = e.message || String(e);
    }finally{
      render();
    }
  }

  /* ---------------- Drawer ---------------- */
  async function openDrawer(id){
    try{
      const { data, error } = await S.sb.from("basiskarakteriseringer").select("*").eq("id", id).single();
      if (error) throw error;
      S.current = data;
      S.drawerOpen = true;
      render();
      API.onDrawerOpen && API.onDrawerOpen(data);
      await loadFilesForCurrent();
    }catch(e){
      S.error = e.message||String(e);
      S.drawerOpen = false;
      render();
    }
  }
  function closeDrawer(){
    S.drawerOpen=false; S.current=null;
    document.documentElement.classList.remove("att-noscroll");
    document.body.classList.remove("att-noscroll");
    render();
    API.onDrawerClose && API.onDrawerClose();
  }

  /* ---------------- Validation ---------------- */
  function requireNoteIfNeedsInfo(root){
    const status = root.querySelector("#f-status")?.value || "";
    if (status === "Trenger mer info"){
      const note = (root.querySelector("#f-note")?.value || "").trim();
      if (!note) throw new Error("Når status er «Trenger mer info» må du fylle ut Notat.");
    }
  }

  /* ---------------- Save ---------------- */
  async function persistEdit(){
    if (!S.current) return;
    const root = ensureRoot();

    const val = (sel)=> (root.querySelector(sel)?.value || "").trim();
    const valOrNull = (sel)=>{ const s=val(sel); return s? s:null; };
    const selVal = (sel)=> root.querySelector(sel)?.value || "";
    const selOrNull=(sel)=>{ const s=selVal(sel); return s? s:null; };
    const bool = (sel)=> !!root.querySelector(sel)?.checked;
    const dateOrNull=(sel)=>{ const s=val(sel); return s||null; };

    try{
      requireNoteIfNeedsInfo(root);
    }catch(e){
      S.error = e.message || String(e);
      render();
      return;
    }

    let payload = {
      prosjekt: val("#f-prosjekt"),
      leveransetype: selVal("#f-leveranse"),
      dato_fra: dateOrNull("#f-dato-fra"),
      dato_til: dateOrNull("#f-dato-til"),
      prosjekt_id: val("#f-prosjekt-id"),
      avfall_velg_type: val("#f-type") || S.current.avfall_velg_type || null,
      avfall_grad: selOrNull("#f-grad"),

      // låst til katalog (aldri manuelt)
      eal: null, varekode: null, ns_kode: null,

      avfall_egenskaper_naeringskode: selOrNull("#f-naerkode-top"),
      naeringskode: valOrNull("#f-naerkode"),

      avfall_egenskaper_forbehandling: selOrNull("#f-forbehandling"),
      avfall_egenskaper_forbehandling_annet: valOrNull("#f-forbehandling-annet"),

      avfall_egenskaper_forbudt_deponering: selOrNull("#f-forbudt"),
      avfall_industri: selOrNull("#f-industri"),

      avfall_lukten: valOrNull("#f-lukt"),
      avfall_fargen: valOrNull("#f-farge"),

      kontaktperson: valOrNull("#f-kontakt"),
      epost: valOrNull("#f-epost"),
      telefonnummer: valOrNull("#f-telefon"),

      avfallsprod_kundenavn: valOrNull("#f-kundenavn"),
      avfallsprod_orgnr: valOrNull("#f-orgnr"),
      avfallsprod_avtalenr: valOrNull("#f-avtalenr"),

      mangler_analyse: bool("#f-mangler-analyse"),

      review_status: selVal("#f-status"),
      review_note: valOrNull("#f-note"),
    };

    payload = applyCodesFromCatalog(payload);

    S.saving=true; S.error=""; render();
    try{
      const { data, error } = await S.sb.from("basiskarakteriseringer")
        .update(payload)
        .eq("id", S.current.id)
        .select("*")
        .single();
      if (error) throw error;

      S.current = data;
      S.toast = "Lagret!";
      setTimeout(()=>{ S.toast=""; render(); }, 1400);

      silentFetchList();
      API.onAfterSave && API.onAfterSave(data);
    }catch(e){
      S.error = e.message||String(e);
    }finally{
      S.saving=false; render();
    }
  }

  /* ---------------- Render ---------------- */
  function render(){
    const root = ensureRoot();

    // Lock scroll behind drawer
    document.documentElement.classList.toggle("att-noscroll", !!S.drawerOpen);
    document.body.classList.toggle("att-noscroll", !!S.drawerOpen);

    const activeCols = COLUMN_DEFS.filter(c => S.columns.includes(c.key));
    const tableHead = `
      <tr>
        ${activeCols.map(c=>`<th>${esc(c.label)}</th>`).join("")}
        <th></th>
      </tr>
    `;
    const tableBody = S.rows.map(r=>`
      <tr>
        ${activeCols.map(c=>`<td>${c.render(r)}</td>`).join("")}
        <td><button class="att-btn ghost" data-edit="${esc(r.id)}">Rediger</button></td>
      </tr>
    `).join("");

    root.innerHTML = `
      <div class="att-card">
        <div class="att-head">
          <h3>Basiskarakteriseringer – Admin</h3>
          <div class="att-row">
            <input id="adm-q" class="att-input" type="search"
              placeholder="Søk kunde / prosjekt / avfallstype / orgnr / avtalenr…"
              value="${esc(S.q)}">
            <div class="att-actions">
              <div class="att-col-menu">
                <button id="adm-cols" class="att-btn ghost" type="button">Kolonner</button>
                <div id="adm-col-panel" class="att-col-panel ${S.colMenuOpen ? "is-open" : ""}">
                  <div class="att-col-head">Vis kolonner</div>
                  <div class="att-col-list">
                    ${COLUMN_DEFS.map(c=>`
                      <label class="att-col-item">
                        <input type="checkbox" data-col="${esc(c.key)}" ${S.columns.includes(c.key) ? "checked" : ""}>
                        <span>${esc(c.label)}</span>
                      </label>
                    `).join("")}
                  </div>
                  <div class="att-col-actions">
                    <button class="att-btn ghost" type="button" data-col-preset="default">Standard</button>
                    <button class="att-btn ghost" type="button" data-col-preset="all">Alle</button>
                  </div>
                </div>
              </div>
              <div id="att-actions-slot"></div>
            </div>
          </div>
        </div>

        <div class="att-body">
          ${S.error ? `<div class="att-error" style="margin:10px 0 10px">${esc(S.error)}</div>` : ``}

          ${S.stats.loading ? `<div class="att-muted">Laster oversikt…</div>` : S.stats.error ? `<div class="att-error" style="margin:10px 0 10px">${esc(S.stats.error)}</div>` : `
            <div class="att-tabs">
              ${[
                { key: "all", label: "Alle", count: S.stats.total },
                { key: "status:Under behandling", label: "Under behandling", count: S.stats.pending },
                { key: "status:Trenger mer info", label: "Trenger mer info", count: S.stats.needsInfo },
                { key: "approved", label: "Godkjent", count: S.stats.approved },
                { key: "active", label: "Aktive", count: S.stats.active },
                { key: "expiring", label: "Utløper snart", count: S.stats.expiring },
                { key: "expired", label: "Utløpt", count: S.stats.expired },
                { key: "status:Avvist", label: "Avvist", count: S.stats.rejected },
                { key: "status:Arkivert", label: "Arkivert", count: S.stats.archived },
              ].map(item => `
                <button class="att-tab ${S.tab===item.key ? "is-active" : ""}" data-tab="${esc(item.key)}" type="button">
                  <span>${esc(item.label)}</span>
                  <span class="count">${item.count}</span>
                </button>
              `).join("")}
            </div>

            <div class="att-metrics">
              ${[
                { label: "Totalt", value: S.stats.total, sub: "Alle basiser" },
                { label: "Godkjent", value: S.stats.approved, sub: "Godkjente" },
                { label: "Aktive", value: S.stats.active, sub: "Gyldige nå" },
                { label: "Utløper snart", value: S.stats.expiring, sub: "Innen 30 dager" },
                { label: "Utløpt", value: S.stats.expired, sub: "Må oppdateres" },
                { label: "Trenger mer info", value: S.stats.needsInfo, sub: "Krever oppfølging" },
              ].map(item => `
                <div class="att-metric">
                  <div class="label">${esc(item.label)}</div>
                  <div class="value">${item.value}</div>
                  <div class="sub">${esc(item.sub)}</div>
                </div>
              `).join("")}
            </div>
          `}

          <div class="att-table-wrap ${S.loading ? "is-loading" : ""}">
            ${S.loading ? `<div class="att-table-mask">Laster…</div>` : ``}
            <table class="att-table">
              <thead>
                ${tableHead}
              </thead>
              <tbody>
                ${tableBody}
                ${S.rows.length===0 && !S.loading ? `<tr><td colspan="${activeCols.length + 1}" class="att-muted">Ingen treff.</td></tr>` : ``}
              </tbody>
            </table>
          </div>

          <div class="att-foot">
            <div class="att-pagination">
              <button class="att-btn ghost" id="p-prev" ${(S.page<=1 || S.loading)?'disabled':''}>Forrige</button>
              <span class="att-muted">Side ${S.page}${S.total?` av ${Math.max(1,Math.ceil(S.total/S.pageSize))}`:''}</span>
              <button class="att-btn ghost" id="p-next" ${(S.page>=Math.max(1,Math.ceil(S.total/S.pageSize)) || S.loading)?'disabled':''}>Neste</button>
            </div>
          </div>
        </div>
      </div>

      <div id="adm-drawer" class="att-drawer" ${S.drawerOpen?'style="display:block"':''}>
        <div class="panel">
          <div class="panel-head">
            <div class="att-row">
              <strong>Basiskarakterisering – Admin</strong>
              ${S.current? statusPill(S.current.review_status,true):''}
              <div id="att-drawer-actions-slot"></div>
            </div>
            <button id="x" class="att-x" aria-label="Lukk">×</button>
          </div>
          <div class="panel-body">
            ${S.current ? renderDrawerBody(S.current) : `<div class="att-muted">Ingen rad valgt.</div>`}
          </div>
        </div>
      </div>

      ${S.toast ? `<div style="position:fixed;right:16px;bottom:16px" class="att-ok">${esc(S.toast)}</div>`:''}
    `;

    // Bindings (list)
    const qEl = root.querySelector("#adm-q");
    qEl?.addEventListener("input", debounce((e)=>{
      S.q = e.target.value||""; S.page=1; silentFetchList();
    }, 250));

    root.querySelectorAll("[data-tab]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const next = btn.getAttribute("data-tab") || "all";
        if (S.tab === next) return;
        S.tab = next;
        S.page = 1;
        silentFetchList();
      });
    });

    root.querySelectorAll("[data-edit]").forEach(btn=>{
      btn.addEventListener("click", ()=>openDrawer(btn.getAttribute("data-edit")));
    });

    root.querySelector("#p-prev")?.addEventListener("click", ()=>{ if(S.page>1){ S.page--; silentFetchList(); }});
    root.querySelector("#p-next")?.addEventListener("click", ()=>{ const m=Math.max(1,Math.ceil(S.total/S.pageSize)); if(S.page<m){ S.page++; silentFetchList(); }});

    const colBtn = root.querySelector("#adm-cols");
    const colPanel = root.querySelector("#adm-col-panel");
    colBtn?.addEventListener("click", (e)=>{
      e.stopPropagation();
      S.colMenuOpen = !S.colMenuOpen;
      render();
    });
    colPanel?.addEventListener("click", (e)=>e.stopPropagation());
    root.querySelectorAll("[data-col]").forEach(ch=>{
      ch.addEventListener("change", ()=>{
        const key = ch.getAttribute("data-col");
        if (!key) return;
        const next = new Set(S.columns);
        if (ch.checked) next.add(key);
        else next.delete(key);
        if (next.size === 0) return;
        S.columns = Array.from(next);
        saveColumnPrefs(S.columns);
        render();
      });
    });
    root.querySelectorAll("[data-col-preset]").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        e.preventDefault();
        const preset = btn.getAttribute("data-col-preset");
        if (preset === "all") {
          S.columns = COLUMN_DEFS.map(c=>c.key);
        } else {
          S.columns = DEFAULT_COLUMNS.slice();
        }
        saveColumnPrefs(S.columns);
        render();
      });
    });
    if (S.colMenuOpen){
      setTimeout(()=>{
        document.addEventListener("click", ()=>{
          if (!S.colMenuOpen) return;
          S.colMenuOpen = false;
          render();
        }, { once:true });
      }, 0);
    }

    const dr = root.querySelector("#adm-drawer");
    root.querySelector("#x")?.addEventListener("click", closeDrawer);
    dr?.addEventListener("click",(e)=>{ if(e.target===dr) closeDrawer(); });

    // Stop propagation when clicking inside panel (avoid accidental close)
    root.querySelector("#adm-drawer .panel")?.addEventListener("click",(e)=>e.stopPropagation());

    // Drawer bindings
    if (S.current){
      root.querySelector("#adm-save")?.addEventListener("click", persistEdit);

      // ESC to close (bind once per render; safe with {once:true})
      document.addEventListener("keydown", (ev)=>{
        if (ev.key === "Escape") closeDrawer();
      }, { once:true });

      // Focus first field
      setTimeout(()=>{ root.querySelector("#f-type")?.focus?.(); }, 0);

      const naerTopEl = root.querySelector("#f-naerkode-top");
      const naerKodeEl = root.querySelector("#f-naerkode");
      const statusEl = root.querySelector("#f-status");
      const noteReq = root.querySelector("#note-required");

      const syncNaer = ()=>{
        const code = NAERINGSKODE_MAP[naerTopEl?.value||""] || "";
        // Only fill if empty (avoid surprising overwrites)
        if (naerKodeEl && !naerKodeEl.value) naerKodeEl.value = code;
      };

      const noteRuleUI = ()=>{
        const needs = (statusEl?.value||"") === "Trenger mer info";
        noteReq?.classList.toggle("att-hide", !needs);
      };

      naerTopEl?.addEventListener("change", syncNaer);
      statusEl?.addEventListener("change", noteRuleUI);

      syncNaer();
      noteRuleUI();

      // Auto default grad from catalog when type changes (if grad empty)
      const typeEl = root.querySelector("#f-type");
      const gradEl = root.querySelector("#f-grad");
      const applyDefaultGradFromType = ()=>{
        const t = typeEl?.value || "";
        if (!t || !gradEl) return;
        const hit = findKatalogMatch(t, null);
        const def = hit?.default_grad || "";
        if (def && !gradEl.value) gradEl.value = def;
      };
      typeEl?.addEventListener("change", applyDefaultGradFromType);
      typeEl?.addEventListener("blur", applyDefaultGradFromType);

      // Upload
      root.querySelector("#adm-upload-files")?.addEventListener("change", async (e)=>{
        const fl = e.target.files;
        if (fl && fl.length) await uploadAdminFiles(fl);
        e.target.value = "";
      });

      API.onDrawerRendered && API.onDrawerRendered(root);
    }

    API.onRendered && API.onRendered(root);
  }

  function renderDrawerBody(r){
    const typeOptions = S.katTypes.map(t=>`<option value="${esc(t)}"></option>`).join("");
    const hit = findKatalogMatch(r.avfall_velg_type||"", r.avfall_grad||null);

    const eal = hit?.eal ?? "";
    const varekode = hit?.varekode ?? "";
    const ns = hit?.ns_kode ?? "";

    return `
      <div class="att-sect">
        <div class="att-row" style="gap:8px;flex-wrap:wrap">
          ${r.avfallsprod_kundenavn ? `<span class="att-pill">Kunde: <strong>${esc(r.avfallsprod_kundenavn)}</strong></span>` : ``}
          ${r.prosjekt ? `<span class="att-pill">Prosjekt: <strong>${esc(r.prosjekt)}</strong></span>` : ``}
          <span class="att-pill">Opprettet: <strong>${fmtHuman(r.created_at)}</strong></span>
          ${r.updated_at ? `<span class="att-pill">Oppdatert: <strong>${fmtHuman(r.updated_at)}</strong></span>` : ``}
        </div>
      </div>

      <div class="att-sect">
        <h4>Status</h4>
        <div class="att-grid">
          ${selKV("Status", "f-status", ENUMS.review_status_enum, r.review_status)}
          ${textAreaKV("Notat (Visest for kunde)", "f-note", r.review_note||"", "Notat er påkrevd når status = Trenger mer info")}
          <div id="note-required" class="att-note att-hide" style="grid-column:1/-1">
            <strong>Notat er påkrevd</strong> når status er <strong>Trenger mer info</strong>.
          </div>
        </div>
      </div>

      <div class="att-sect">
        <h4>Avfallstype & koder (låst)</h4>
        <div class="att-grid">
          <div class="att-kv">
            <label class="att-label">Avfallstype</label>
            <input id="f-type" class="att-input" list="att-katalog-types" value="${esc(r.avfall_velg_type||"")}">
            <datalist id="att-katalog-types">${typeOptions}</datalist>
            <div class="att-muted" style="font-size:12px">Koder settes automatisk fra katalog ved lagring.</div>
          </div>

          ${selKV("Grad", "f-grad", ["",...ENUMS.avfall_grad], r.avfall_grad||"")}

          <!-- MOVED + RENAMED -->
          ${selKV("Har avfallet oppstått ved industri?", "f-industri", ["",...ENUMS.ja_nei], r.avfall_industri||"")}

          ${readonlyKV("EAL (fra katalog)", "f-eal", eal)}
          ${readonlyKV("Varekode (fra katalog)", "f-varekode", varekode)}
          ${readonlyKV("NS-kode (fra katalog)", "f-ns", ns)}
        </div>
      </div>

      <div class="att-sect">
        <h4>Prosjekt & periode</h4>
        <div class="att-grid">
          ${textKV("Prosjekt", "f-prosjekt", r.prosjekt||"")}
          ${textKV("Prosjekt-ID", "f-prosjekt-id", r.prosjekt_id||"")}
          ${selKV("Leveransetype", "f-leveranse", ["",...ENUMS.leveranse_type], r.leveransetype||"")}
          ${dateKV("Dato fra", "f-dato-fra", fmtDate(r.dato_fra))}
          ${dateKV("Dato til", "f-dato-til", fmtDate(r.dato_til))}
        </div>
      </div>

      <div class="att-sect">
        <h4>Klassifisering</h4>
        <div class="att-grid">
          ${selKV("Næringskode (topp)", "f-naerkode-top", ["",...ENUMS.naeringskode_top], r.avfall_egenskaper_naeringskode||"")}
          ${readonlyKV("Næringskode", "f-naerkode", r.naeringskode||"")}
          ${selKV("Forbudt deponering", "f-forbudt", ["",...ENUMS.ja_nei_usikker], r.avfall_egenskaper_forbudt_deponering||"")}
          ${selKV("Forbehandling", "f-forbehandling", ["",...ENUMS.forbehandling], r.avfall_egenskaper_forbehandling||"")}
          ${textKV("Forbehandling (annet)", "f-forbehandling-annet", r.avfall_egenskaper_forbehandling_annet||"")}
          ${textKV("Lukt", "f-lukt", r.avfall_lukten||"")}
          ${textKV("Farge", "f-farge", r.avfall_fargen||"")}
          ${switchKV("Mangler analyse", "f-mangler-analyse", !!r.mangler_analyse)}
        </div>
      </div>

      <div class="att-sect">
        <h4>Kunde / kontakt</h4>
        <div class="att-grid">
          ${textKV("Kundenavn", "f-kundenavn", r.avfallsprod_kundenavn||"")}
          ${textKV("Org.nr", "f-orgnr", r.avfallsprod_orgnr||"")}
          ${textKV("Avtalenr", "f-avtalenr", r.avfallsprod_avtalenr||"")}
          ${textKV("Kontaktperson", "f-kontakt", r.kontaktperson||"")}
          ${textKV("E-post", "f-epost", r.epost||"")}
          ${textKV("Telefon", "f-telefon", r.telefonnummer||"")}
        </div>
      </div>

      <div class="att-sect">
        <h4>Vedlegg</h4>
        <div class="att-row" style="align-items:center;margin-bottom:10px">
          <input id="adm-upload-files" class="att-input" type="file" multiple style="padding:8px" ${S.uploading?'disabled':''}>
          <span class="att-muted" style="font-size:12px">${S.uploading?'Laster opp…':''}</span>
        </div>
        ${filesHtml()}
      </div>

      <!-- Sticky save -->
      <div class="panel-foot">
        <div class="att-row" style="justify-content:flex-end">
          <button id="adm-save" class="att-btn" ${S.saving?'disabled':''}>${S.saving?'Lagrer…':'Lagre endringer'}</button>
        </div>
      </div>
    `;
  }

  /* ---------------- Field builders ---------------- */
  function textKV(label, id, value){
    return `<div class="att-kv"><label class="att-label" for="${id}">${label}</label><input id="${id}" class="att-input" value="${esc(value||"")}"></div>`;
  }
  function readonlyKV(label, id, value){
    return `<div class="att-kv"><label class="att-label" for="${id}">${label}</label><input id="${id}" class="att-input" value="${esc(value||"")}" readonly style="background:#f3f4f6;cursor:not-allowed;opacity:.9"></div>`;
  }
  function textAreaKV(label, id, value, ph=""){
    return `<div class="att-kv" style="grid-column:1/-1"><label class="att-label" for="${id}">${label}</label><textarea id="${id}" class="att-text" placeholder="${esc(ph)}">${esc(value||"")}</textarea></div>`;
  }
  function dateKV(label, id, value){
    return `<div class="att-kv"><label class="att-label" for="${id}">${label}</label><input id="${id}" class="att-input" type="date" value="${esc(value||"")}"></div>`;
  }
  function selKV(label, id, options, value){
    return `<div class="att-kv"><label class="att-label" for="${id}">${label}</label><select id="${id}" class="att-select">${options.map(o=>`<option value="${esc(o)}" ${String(value||"")===String(o)?'selected':''}>${o===""?"(tom)":esc(o)}</option>`).join("")}</select></div>`;
  }
  function switchKV(label, id, on){
    return `<div class="att-kv"><label class="att-label">${label}</label><label class="att-switch"><input id="${id}" type="checkbox" ${on?'checked':''}><span>${on?'På':'Av'}</span></label></div>`;
  }

  /* ---------------- Boot ---------------- */
  async function boot(){
    const root = ensureRoot();
    root.innerHTML = `<div class="att-card"><div class="att-head"><h3>Basiskarakteriseringer – Admin</h3></div><div class="att-body"><div class="att-muted">Laster…</div></div></div>`;
    try{
      S.sb = await getSupabaseClient();
      const { data, error } = await S.sb.rpc("is_admin");
      if (error) throw error;
      S.isAdmin = !!data;
      if (!S.isAdmin) throw new Error("403 – Du mangler admin-tilgang.");
      await loadKatalog();
      await silentFetchList();
    }catch(e){
      S.error = e.message||String(e);
      render();
    }
  }

  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

(function(){
  function onReady(fn){
    const t = setInterval(()=>{
      if (window.AttBKAdmin && window.AttBKAdmin.getSupabase && window.AttBKAdmin.state?.sb){
        clearInterval(t); fn();
      }
    }, 120);
  }

  onReady(()=> {
    const API = window.AttBKAdmin;
    const S = API.state;
    const SC = document.currentScript;

    const esc = (s)=> (s||"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

    // ---- optional: supabase project-ref for "Open in Supabase"
    const SUPA_REF = (SC?.dataset?.supaRef || "").trim(); // e.g. "hrjahnrhcajzyvgwkrya"
    const supaRowUrl = (id)=>{
      if (!SUPA_REF) return "";
      // This URL pattern is stable enough; if it changes later, button just won't be used.
      return `https://supabase.com/dashboard/project/${encodeURIComponent(SUPA_REF)}/editor?table=basiskarakteriseringer&filter=id:eq:${encodeURIComponent(id)}`;
    };

    // -------------------- (A) CSV Export ALL button --------------------
    API.onRendered = (root)=>{
      const slot = root.querySelector("#att-actions-slot");
      if (!slot) return;

      // Export ALL
      if (!slot.querySelector("#adm-export-all")){
        const btn = document.createElement("button");
        btn.id = "adm-export-all";
        btn.className = "att-btn alt";
        btn.textContent = "Eksporter CSV (ALLE)";
        btn.addEventListener("click", async ()=>{
          try{
            btn.disabled = true;
            btn.textContent = "Eksporterer…";

            const sb = API.getSupabase();
            const cols = ["id","avfallsprod_kundenavn","avfallsprod_orgnr","avfallsprod_avtalenr","prosjekt","avfall_velg_type","review_status","dato_fra","dato_til","account_id","created_at","updated_at"];
            const csvEsc = (v)=> v==null ? "" : `"${String(v).replace(/"/g,'""')}"`;

            const pageSize = 1000;
            let from = 0;
            let all = [];

            while(true){
              let q = sb.from("basiskarakteriseringer")
                .select(cols.join(","), { count:"exact" })
                .order("created_at",{ascending:false})
                .range(from, from + pageSize - 1);

              const searchOr = API.buildSearchOr ? API.buildSearchOr(S.q) : "";
              if (searchOr) q = q.or(searchOr);
              if (S.status) q = q.eq("review_status", S.status);

              const { data, error } = await q;
              if (error) throw error;

              const rows = data || [];
              all.push(...rows);
              if (rows.length < pageSize) break;
              from += pageSize;
              await sleep(40);
            }

            if (!all.length){
              alert("Ingenting å eksportere (tomt filter).");
              return;
            }

            const csv = [cols.join(","), ...all.map(r=>cols.map(c=>csvEsc(r[c])).join(","))].join("\n");
            const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
            const url  = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `bk_admin_export_ALL_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(()=>URL.revokeObjectURL(url), 1200);
          }catch(e){
            console.error(e);
            alert("Eksport feilet: " + (e?.message||String(e)));
          }finally{
            const b = root.querySelector("#adm-export-all");
            if (b){ b.disabled = false; b.textContent = "Eksporter CSV (ALLE)"; }
          }
        });
        slot.appendChild(btn);
      }

      // Optional: quick "refresh"
      if (!slot.querySelector("#adm-refresh")){
        const btn = document.createElement("button");
        btn.id = "adm-refresh";
        btn.className = "att-btn ghost";
        btn.textContent = "Oppdater";
        btn.addEventListener("click", ()=>API.refreshList && API.refreshList());
        slot.appendChild(btn);
      }
    };

    // -------------------- (B) Confirm on selecting "Godkjent" --------------------
    let prevStatus = null;
    let confirmOpen = false;
    let pendingApprove = false;

    function isOpenDrawer(root){
      const dr = root.querySelector("#adm-drawer");
      return !!(dr && (dr.style.display === "block" || dr.getAttribute("style")?.includes("display:block")));
    }

    function closeConfirmUI(root){
      confirmOpen = false;
      pendingApprove = false;
      renderConfirmBlock(root);
    }

    function openConfirmUI(root){
      confirmOpen = true;
      pendingApprove = false;
      renderConfirmBlock(root);

      // scroll into view
      setTimeout(()=>{
        const el = root.querySelector("#bk-approve-confirm");
        el?.scrollIntoView?.({ behavior:"smooth", block:"start" });
      }, 20);
    }

    function revertStatus(root){
      const sel = root.querySelector("#f-status");
      if (sel){
        sel.value = prevStatus || "Under behandling";
        sel.dispatchEvent(new Event("change", { bubbles:true }));
      }
    }

    async function maybeGeneratePdfAfterSave(savedRow){
      // Hook point (optional):
      // await API.getSupabase().functions.invoke("bk_generate_pdf", { body: { id: savedRow.id }});
      return;
    }

    // Wrap onAfterSave safely (don’t clobber core)
    const _prevAfterSave = API.onAfterSave;
    API.onAfterSave = async (savedRow)=>{
      if (typeof _prevAfterSave === "function") {
        try { await _prevAfterSave(savedRow); } catch(e){ console.warn("[addons] prev onAfterSave error:", e); }
      }

      if (pendingApprove){
        pendingApprove = false;
        try{
          await maybeGeneratePdfAfterSave(savedRow);
        }catch(e){
          console.error("[PDF after save] fail:", e);
          alert("Status lagret, men PDF-generering feilet: " + (e?.message||String(e)));
        }
      }
    };

    // Track status when drawer opens
    const _prevOnDrawerOpen = API.onDrawerOpen;
    API.onDrawerOpen = async (row)=>{
      if (typeof _prevOnDrawerOpen === "function") {
        try { await _prevOnDrawerOpen(row); } catch(e){ console.warn("[addons] prev onDrawerOpen error:", e); }
      }
      confirmOpen = false;
      pendingApprove = false;
      prevStatus = (API.getCurrent()?.review_status) || "Under behandling";
    };

    // UI injected into drawer body
    function renderConfirmBlock(root){
      const body = root.querySelector(".panel-body");
      if (!body) return;

      let wrap = body.querySelector("#bk-approve-confirm");
      if (!wrap){
        wrap = document.createElement("div");
        wrap.id = "bk-approve-confirm";
        wrap.className = "att-sect";
        body.appendChild(wrap);
      }

      // keep small if closed
      if (!confirmOpen){
        wrap.innerHTML = "";
        return;
      }

      wrap.innerHTML = `
        <h4>Bekreft godkjenning</h4>
        <div class="att-note">
          <strong>Er du helt sikker?</strong><br>
          Når du setter status til <strong>Godkjent</strong> vil det (valgfritt) kunne genereres PDF / trigges videre flyt.
          <div class="att-row" style="margin-top:10px">
            <button id="adm-approve-cancel" class="att-btn ghost">Avbryt</button>
            <button id="adm-approve-go" class="att-btn">Bekreft & lagre</button>
          </div>
        </div>
      `;

      wrap.querySelector("#adm-approve-cancel")?.addEventListener("click", ()=>{
        closeConfirmUI(root);
        revertStatus(root);
      });

      wrap.querySelector("#adm-approve-go")?.addEventListener("click", ()=>{
        confirmOpen = false;
        pendingApprove = true;
        root.querySelector("#adm-save")?.click();
      });
    }

    // -------------------- (C) Extra cool drawer actions --------------------
    API.onDrawerRendered = (root)=>{
      if (!isOpenDrawer(root)) return;

      // 1) Quick actions in header slot
      const slot = root.querySelector("#att-drawer-actions-slot");
      const cur = API.getCurrent();
      if (slot && cur && !slot.dataset.enhanced){
        slot.dataset.enhanced = "1";
        slot.style.gap = "8px";

        // Copy ID
        const copyBtn = document.createElement("button");
        copyBtn.className = "att-btn ghost";
        copyBtn.textContent = "Kopier ID";
        copyBtn.addEventListener("click", async ()=>{
          try{
            await navigator.clipboard.writeText(cur.id);
            // Lightweight toast via core state:
            S.toast = "ID kopiert";
            setTimeout(()=>{ S.toast=""; API.onRendered && API.onRendered(root); }, 900);
          }catch(e){
            alert("Kunne ikke kopiere: " + (e?.message||String(e)));
          }
        });
        slot.appendChild(copyBtn);

        // Open in Supabase (if project ref set)
        if (SUPA_REF){
          const openBtn = document.createElement("a");
          openBtn.className = "att-btn ghost";
          openBtn.textContent = "Åpne i Supabase";
          openBtn.href = supaRowUrl(cur.id);
          openBtn.target = "_blank";
          openBtn.rel = "noopener";
          slot.appendChild(openBtn);
        }

        // Quick status buttons
        const mkStatusBtn = (label, status)=>{
          const b = document.createElement("button");
          b.className = "att-btn alt";
          b.textContent = label;
          b.style.padding = "10px 10px";
          b.addEventListener("click", ()=>{
            const sel = root.querySelector("#f-status");
            if (!sel) return;
            prevStatus = sel.value || prevStatus || "Under behandling";
            sel.value = status;
            sel.dispatchEvent(new Event("change", { bubbles:true }));
          });
          return b;
        };

        slot.appendChild(mkStatusBtn("Under behandling", "Under behandling"));
        slot.appendChild(mkStatusBtn("Trenger mer info", "Trenger mer info"));
        slot.appendChild(mkStatusBtn("Avvist", "Avvist"));
        slot.appendChild(mkStatusBtn("Arkivert", "Arkivert"));
      }

      // 2) Hook status selector once: open confirm when selecting Godkjent
      const statusSel = root.querySelector("#f-status");
      if (statusSel && !statusSel.dataset.approveHooked){
        statusSel.dataset.approveHooked = "1";

        statusSel.addEventListener("focus", ()=>{
          prevStatus = statusSel.value || prevStatus || "Under behandling";
        });

        statusSel.addEventListener("change", ()=>{
          const next = statusSel.value || "Under behandling";

          if (next === "Godkjent" && (prevStatus || "") !== "Godkjent"){
            // don’t allow accidental approve without confirm
            openConfirmUI(root);
          } else {
            // normal changes
            prevStatus = next;
            closeConfirmUI(root);
          }
        });
      }

      // Ensure confirm block state is in sync on each render
      renderConfirmBlock(root);
    };
  });
})();
