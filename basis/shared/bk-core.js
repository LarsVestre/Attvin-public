(() => {
  if (window.BKCore) return;

  const TZ = "Europe/Oslo";

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));

  const debounce = (fn, wait = 250) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  const fmtDateTime = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("no-NO", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("no-NO", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const statusBadge = (reviewStatus) => {
    const span = document.createElement("span");
    const s = reviewStatus || "–";

    const cls =
      s === "Under behandling" ? "st-under" :
      s === "Trenger mer info" ? "st-merinfo" :
      s === "Godkjent" ? "st-godkjent" :
      s === "Avvist" ? "st-avvist" :
      s === "Arkivert" ? "st-arkivert" :
      s === "Innsendt" ? "st-innsendt" :
      "";

    span.className = `bk-badge ${cls}`;
    span.textContent = s;
    return span;
  };

  const computeValidity = (dato_fra, dato_til, settings) => {
    const now = new Date();
    const df = dato_fra ? new Date(dato_fra) : null;
    const dt = dato_til ? new Date(dato_til) : null;
    const warnDays = settings?.days_before_warning ?? 30;

    let daysLeft = null;
    if (dt) {
      const diffMs = dt.getTime() - now.getTime();
      daysLeft = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    let baseStatus;
    if (df && df > now) {
      baseStatus = "ikke-startet";
    } else if (!dt) {
      baseStatus = "aktiv";
    } else if (daysLeft < 0) {
      baseStatus = "utlopt";
    } else {
      baseStatus = "aktiv";
    }

    let label = "";
    let cls = "gray";

    if (baseStatus === "ikke-startet") {
      label = "Ikke startet ennå";
      cls = "gray";
    } else if (!dt) {
      label = "Løpende (ingen sluttdato)";
      cls = "green";
    } else if (daysLeft < 0) {
      label = "Utløpt";
      cls = "red";
    } else if (daysLeft <= warnDays) {
      label = `Utløper snart (${daysLeft} dager igjen)`;
      cls = "amber";
    } else {
      label = `Aktiv (${daysLeft} dager igjen)`;
      cls = "green";
    }

    return { baseStatus, label, cls, daysLeft };
  };

  async function ensureSupabaseJs() {
    if (window.supabase?.createClient) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Kunne ikke laste @supabase/supabase-js"));
      document.head.appendChild(s);
    });
  }

  async function getSupabaseClient({ supabaseUrl, supabaseAnon, requireSession = true } = {}) {
    if (window.AttAuth?.supabaseUserClient) {
      const client = await window.AttAuth.supabaseUserClient();
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      if (requireSession && !data?.user) throw new Error("Ingen innlogget bruker.");
      return { sb: client, user: data?.user || null };
    }

    if (!supabaseUrl || !supabaseAnon) {
      throw new Error("BKCore.getSupabaseClient: mangler supabaseUrl/supabaseAnon.");
    }

    await ensureSupabaseJs();
    const client = window.supabase.createClient(supabaseUrl, supabaseAnon);

    if (!requireSession) {
      return { sb: client, user: null };
    }

    const { data: { session }, error } = await client.auth.getSession();
    if (error) throw error;
    if (!session?.user) throw new Error("Ingen innlogget Supabase-bruker.");
    return { sb: client, user: session.user };
  }

  window.BKCore = {
    TZ,
    esc,
    debounce,
    fmtDate,
    fmtDateTime,
    statusBadge,
    computeValidity,
    getSupabaseClient,
  };
})();
