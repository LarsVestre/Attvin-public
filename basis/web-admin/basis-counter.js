(() => {
  const SC = document.currentScript;
  const CFG = {
    SUPABASE_URL: SC?.dataset?.supaUrl || "",
    SUPABASE_ANON: SC?.dataset?.supaAnon || "",
    SUPABASE_SCHEMA: SC?.dataset?.supaSchema || "",
  };

  if (!window.BKCore) {
    console.error("[BK] BKCore mangler – last inn BKCore før dette scriptet.");
    return;
  }

  const MAX_ROWS = 2000;
  const SOON_DAYS = 30;

  const S = {
    sb: null,
    rows: [],
    loading: false,
    error: "",
    query: "",
    selectedId: null,
    selected: null,
    files: [],
    filesLoading: false,
    filesError: "",
    truncated: false,
  };

  const $ = (id) => document.getElementById(id);
  const listEl = $("counter-list");
  const detailEl = $("counter-detail");
  const noteEl = $("counter-note");

  const esc = window.BKCore.esc;
  const debounce = window.BKCore.debounce;

  const statusClass = (s) => {
    if (s === "Under behandling") return "st-under";
    if (s === "Trenger mer info") return "st-merinfo";
    if (s === "Godkjent") return "st-godkjent";
    if (s === "Avvist") return "st-avvist";
    if (s === "Arkivert") return "st-arkivert";
    if (s === "Innsendt") return "st-innsendt";
    return "";
  };

  const isoDate = (offsetDays = 0) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };

  function computeValidity(row) {
    if (row.review_status !== "Godkjent") return null;
    return window.BKCore.computeValidity(row.dato_fra, row.dato_til, {
      days_before_warning: SOON_DAYS,
    });
  }

  function isActive(row) {
    if (row.review_status !== "Godkjent") return false;
    const validity = computeValidity(row);
    return validity?.cls !== "red";
  }

  function sortRows(rows) {
    return [...rows].sort((a, b) => {
      const aActive = isActive(a) ? 1 : 0;
      const bActive = isActive(b) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const ad = new Date(a.created_at || 0).getTime();
      const bd = new Date(b.created_at || 0).getTime();
      return bd - ad;
    });
  }

  function renderList() {
    if (!listEl) return;
    if (S.loading) {
      listEl.innerHTML = '<div class="notice">Laster…</div>';
      return;
    }
    if (S.error) {
      listEl.innerHTML = `<div class="error">${esc(S.error)}</div>`;
      return;
    }

    if (!S.rows.length) {
      listEl.innerHTML = '<div class="notice">Ingen treff.</div>';
      return;
    }

    listEl.innerHTML = S.rows.map((row) => {
      const validity = computeValidity(row);
      const isSelected = String(S.selectedId || "") === String(row.id);
      const status = row.review_status || "–";
      const customer = row.avfallsprod_kundenavn || row.account_id || "Ukjent";
      const org = row.avfallsprod_orgnr ? `Org.nr ${row.avfallsprod_orgnr}` : "";
      const project = row.prosjekt || "–";
      const type = row.avfall_velg_type || "–";
      const validityHtml = validity
        ? `<span class="validity ${validity.cls}">${esc(validity.label)}</span>`
        : "";

      return `
        <div class="counter-item ${isSelected ? "is-active" : ""}" data-id="${esc(row.id)}">
          <div class="counter-row">
            <div class="counter-name">${esc(customer)}</div>
            ${org ? `<div class="counter-muted">${esc(org)}</div>` : ""}
          </div>
          <div class="counter-row">
            <div class="counter-muted">${esc(project)}</div>
            <div class="counter-muted">•</div>
            <div class="counter-muted">${esc(type)}</div>
          </div>
          <div class="counter-row">
            <span class="counter-badge ${statusClass(status)}">${esc(status)}</span>
            ${validityHtml}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderDetail() {
    if (!detailEl) return;
    if (!S.selected) {
      detailEl.innerHTML = '<div class="notice">Velg en basis for detaljer.</div>';
      return;
    }

    const r = S.selected;
    const validity = computeValidity(r);
    const status = r.review_status || "–";
    const period = (r.dato_fra || r.dato_til) ? `${r.dato_fra || "?"} – ${r.dato_til || "?"}` : "—";

    const filesHtml = S.filesLoading
      ? '<div class="notice">Laster vedlegg…</div>'
      : S.filesError
        ? `<div class="error">${esc(S.filesError)}</div>`
        : S.files.length
          ? `<div class="file-list">${S.files.map(f => `
                <div class="file-row">
                  <div><strong>${esc(f.original_name || "Vedlegg")}</strong></div>
                  <div class="counter-muted">${f.created_at ? esc(new Date(f.created_at).toLocaleString("no-NO")) : ""}</div>
                  ${f.signed_url ? `<a href="${esc(f.signed_url)}" target="_blank" rel="noopener">Åpne</a>` : ""}
                </div>
              `).join("")}</div>`
          : '<div class="notice">Ingen vedlegg.</div>';

    detailEl.innerHTML = `
      <div class="detail-grid">
        <div class="k">Kunde</div><div>${esc(r.avfallsprod_kundenavn || "-")}</div>
        <div class="k">Org.nr</div><div>${esc(r.avfallsprod_orgnr || "-")}</div>
        <div class="k">Avtalenr</div><div>${esc(r.avfallsprod_avtalenr || "-")}</div>
        <div class="k">Prosjekt</div><div>${esc(r.prosjekt || "-")}</div>
        <div class="k">Avfallstype</div><div>${esc(r.avfall_velg_type || "-")}</div>
        <div class="k">Status</div><div><span class="counter-badge ${statusClass(status)}">${esc(status)}</span></div>
        <div class="k">Periode</div><div>${esc(period)}</div>
        <div class="k">Gyldighet</div><div>${validity ? `<span class="validity ${validity.cls}">${esc(validity.label)}</span>` : "-"}</div>
        <div class="k">Vurdert</div><div>${esc(r.reviewed_at ? window.BKCore.fmtDateTime(r.reviewed_at) : "-")}</div>
        <div class="k">Notat</div><div>${esc(r.review_note || "-")}</div>
        <div class="k">EAL</div><div>${esc(r.eal || "-")}</div>
        <div class="k">Varekode</div><div>${esc(r.varekode || "-")}</div>
        <div class="k">NS-kode</div><div>${esc(r.ns_kode || "-")}</div>
      </div>

      <div class="detail-section">
        <h3>PDF / godkjent basis</h3>
        ${r.pdf_storage_path ? `<div class="notice">PDF er tilgjengelig${r.pdf_generated_at ? ` (generert ${esc(window.BKCore.fmtDateTime(r.pdf_generated_at))})` : ""}. <button id="counter-pdf" class="counter-badge st-godkjent" type="button">Åpne PDF</button></div>` : '<div class="notice">PDF ikke generert.</div>'}
      </div>

      <div class="detail-section">
        <h3>Vedlegg</h3>
        ${filesHtml}
      </div>
    `;

    const pdfBtn = document.getElementById("counter-pdf");
    if (pdfBtn && r.pdf_storage_path) {
      pdfBtn.addEventListener("click", () => openPdf(r.pdf_storage_path));
    }
  }

  async function openPdf(path) {
    try {
      const { data, error } = await S.sb.storage.from("bk-files").createSignedUrl(path, 120);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    } catch (e) {
      alert("Kunne ikke åpne PDF.");
    }
  }

  async function loadFiles(bkId) {
    S.filesLoading = true;
    S.filesError = "";
    renderDetail();
    try {
      const { data, error } = await S.sb.from("bk_files")
        .select("id,storage_path,original_name,created_at")
        .eq("bk_id", bkId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const files = data || [];
      let signed = [];
      if (files.length) {
        const paths = files.map((f) => f.storage_path);
        const { data: urlData, error: urlErr } = await S.sb.storage.from("bk-files").createSignedUrls(paths, 120);
        if (urlErr) throw urlErr;
        signed = urlData || [];
      }
      S.files = files.map((f, idx) => ({ ...f, signed_url: signed[idx]?.signedUrl || null }));
    } catch (e) {
      S.files = [];
      S.filesError = e.message || String(e);
    } finally {
      S.filesLoading = false;
      renderDetail();
    }
  }

  async function loadRows() {
    if (!S.sb) return;
    S.loading = true;
    S.error = "";
    renderList();
    try {
      let q = S.sb
        .from("basiskarakteriseringer")
        .select("id,avfallsprod_kundenavn,avfallsprod_orgnr,avfallsprod_avtalenr,prosjekt,avfall_velg_type,review_status,review_note,reviewed_at,dato_fra,dato_til,created_at,updated_at,account_id,eal,varekode,ns_kode,pdf_storage_path,pdf_generated_at")
        .order("created_at", { ascending: false })
        .range(0, MAX_ROWS - 1);

      const s = (S.query || "").trim().replace(/%/g, "");
      if (s) {
        const orParts = [
          `avfallsprod_kundenavn.ilike.%${s}%`,
          `avfallsprod_orgnr.ilike.%${s}%`,
          `avfallsprod_avtalenr.ilike.%${s}%`,
          `prosjekt.ilike.%${s}%`,
          `avfall_velg_type.ilike.%${s}%`,
        ];

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
        if (isUuid) {
          orParts.push(`account_id.eq.${s}`);
        }

        q = q.or(orParts.join(","));
      }

      const { data, error } = await q;
      if (error) throw error;

      S.rows = sortRows(data || []);
      S.truncated = (data || []).length >= MAX_ROWS;
      S.loading = false;
      S.error = "";

      if (S.rows.length) {
        const first = S.rows[0];
        selectRow(first.id);
      } else {
        S.selectedId = null;
        S.selected = null;
        S.files = [];
        renderDetail();
      }
    } catch (e) {
      S.error = e.message || String(e);
      S.loading = false;
    } finally {
      renderList();
      noteEl.textContent = S.truncated
        ? `Viser første ${MAX_ROWS} treff. Spiss søket for å se flere.`
        : "";
    }
  }

  function selectRow(id) {
    S.selectedId = id;
    S.selected = S.rows.find((r) => String(r.id) === String(id)) || null;
    renderList();
    renderDetail();
    if (S.selectedId) loadFiles(S.selectedId);
  }

  function bindEvents() {
    const search = $("counter-search");
    if (search) {
      search.addEventListener(
        "input",
        debounce((e) => {
          S.query = e.target.value || "";
          loadRows();
        }, 250)
      );
    }

    listEl?.addEventListener("click", (e) => {
      const item = e.target.closest("[data-id]");
      if (!item) return;
      selectRow(item.getAttribute("data-id"));
    });
  }

  async function boot() {
    try {
      const { sb } = await window.BKCore.getSupabaseClient({
        supabaseUrl: CFG.SUPABASE_URL,
        supabaseAnon: CFG.SUPABASE_ANON,
        requireSession: false,
      });
      if (CFG.SUPABASE_SCHEMA) {
        S.sb = typeof sb.schema === "function" ? sb.schema(CFG.SUPABASE_SCHEMA) : sb;
      } else {
        S.sb = sb;
      }

      // Optional admin check (non-fatal if RPC missing)
      try {
        const { data, error } = await S.sb.rpc("is_admin");
        if (!error && data === false) {
          S.error = "Du mangler admin-tilgang.";
          renderList();
          return;
        }
      } catch (_) {}

      bindEvents();
      await loadRows();
    } catch (e) {
      S.error = e.message || String(e);
      renderList();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
