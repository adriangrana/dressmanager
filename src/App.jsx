import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Archive, ArrowDownRight, ArrowRight, ArrowUpRight, BadgeEuro, Banknote, CalendarCheck,
  CalendarDays, Check, ChevronDown, CircleCheck, CircleDollarSign, Clock3, Eye, ImagePlus,
  Info, LayoutDashboard, LockKeyhole, LogOut, Mail, Menu, Package, Phone, Plus, ReceiptText,
  Search, Shirt, Sparkles, TrendingUp, Wallet, X, XCircle,
} from "lucide-react";
import { api, formatDate, formatMoney } from "./api.js";

const FALLBACK_IMAGE = "/images/vestidos/aurora-rose/frente.png";
const DEFAULT_SETTINGS = { vat_rate: 0.21, helper_hourly_cost: 20 };
const localDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};
const tariffFor = (dress, type) => dress?.tariffs?.[type] || { price: type === "interior" ? 230 : 350, includedMinutes: type === "interior" ? 30 : 120, extraPrice: 25, extraMinutes: type === "interior" ? 30 : 60, maintenance: type === "interior" ? 15 : 30 };
const isPriced = (dress) => ["interior", "exterior"].every((type) => [tariffFor(dress, type).price, tariffFor(dress, type).extraPrice, tariffFor(dress, type).maintenance].every((amount) => Number(amount) > 0));
const displayTariff = (dress, type) => Number(tariffFor(dress, type).price) > 0 ? formatMoney(tariffFor(dress, type).price) : "Pendiente";
const priceFor = (dress, type, minutes) => { const tariff = tariffFor(dress, type); return Number(tariff.price) + Math.ceil(Math.max(0, Number(minutes) - Number(tariff.includedMinutes)) / Number(tariff.extraMinutes)) * Number(tariff.extraPrice); };
const economicsFor = (dress, type, minutes, settings = DEFAULT_SETTINGS) => {
  const gross = priceFor(dress, type, minutes);
  const vat = gross * Number(settings.vat_rate) / (1 + Number(settings.vat_rate));
  const helper = type === "exterior" ? Number(minutes) / 60 * Number(settings.helper_hourly_cost) : 0;
  const maintenance = Number(tariffFor(dress, type).maintenance);
  const profit = gross - vat - helper - maintenance;
  return { gross, vat, helper, maintenance, profit, share: profit / 2 };
};
const durationLabel = (minutes) => minutes % 60 ? `${Math.floor(minutes / 60)} h 30 min`.replace(/^0 h /, "30 min") : `${minutes / 60} ${minutes === 60 ? "hora" : "horas"}`;
const durationOptions = (type) => type === "interior" ? Array.from({ length: 12 }, (_, i) => 30 * (i + 1)) : Array.from({ length: 8 }, (_, i) => 60 * (i + 1));
const typeLabel = (type) => type === "interior" ? "Interior" : "Exterior";
const timeOptions = Array.from({ length: 32 }, (_, index) => {
  const total = 7 * 60 + index * 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
});
const addMinutesToTime = (time, minutes) => {
  const [hours, mins] = String(time || "10:00").split(":").map(Number);
  const total = hours * 60 + mins + Number(minutes || 0);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const bookingTimeLabel = (booking) => `${booking.startTime || "10:00"}–${booking.endTime || addMinutesToTime(booking.startTime || "10:00", booking.durationMinutes)}`;
const paymentLabel = (status) => status === "paid" ? "Cobrada" : "Pendiente de cobro";

function Brand({ light = false }) {
  return <Link className={`brand-lockup ${light ? "brand-light" : ""}`} to="/" aria-label="Tul en Foco, inicio">
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <circle className="brand-mark-ring" cx="32" cy="32" r="28" />
      <circle className="brand-mark-lens" cx="32" cy="32" r="22" />
      <path className="brand-dress" d="M27 18.5c1.4 1.1 3.1 1.7 5 1.7s3.6-.6 5-1.7l-1.4 10.1c1.5 1.5 3.3 2.7 5.3 4.1l7.2 13.5c-4.6 2.3-9.9 3.5-16.1 3.5s-11.5-1.2-16.1-3.5l7.2-13.5c2-1.4 3.8-2.6 5.3-4.1L27 18.5Z" />
      <path className="brand-dress-detail" d="M27 18.5c1.2 2.2 2.9 3.3 5 3.3s3.8-1.1 5-3.3M27.4 29.1h9.2M23.9 33.4c2.4 1.1 5.1 1.7 8.1 1.7s5.7-.6 8.1-1.7M25.1 34.1l-3.8 10.2M38.9 34.1l3.8 10.2M32 35.2v13.6" />
      <path className="brand-sparkle" d="M49 10.5v6m-3-3h6m-2.1 2.1 2.1 2.1m-4.2-4.2-2.1-2.1" />
      <circle className="brand-mark-dot" cx="13.5" cy="32" r="1" />
      <circle className="brand-mark-dot" cx="50.5" cy="32" r="1" />
    </svg>
    <span><strong>Tul en Foco</strong><small>VESTIDOS · FOTOGRAFÍA</small></span>
  </Link>;
}

function App() {
  return <Routes>
    <Route path="/" element={<PublicShop />} />
    <Route path="/admin/login" element={<AdminLogin />} />
    <Route path="/admin" element={<AdminGate />}>
      <Route index element={<Navigate to="resumen" replace />} />
      <Route path="resumen" element={<AdminDashboard />} />
      <Route path="vestidos" element={<AdminDresses />} />
      <Route path="reservas" element={<AdminBookings />} />
      <Route path="finanzas" element={<AdminFinance />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

function PublicShop() {
  const [dresses, setDresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [selected, setSelected] = useState(null);
  const [bookingDress, setBookingDress] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api("/api/public/dresses").then((data) => setDresses(data.dresses)).catch(() => setNotice("No pudimos cargar el catálogo. Prueba a recargar la página.")).finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => [...new Set(dresses.map((dress) => dress.category).filter(Boolean))], [dresses]);
  const filtered = useMemo(() => dresses.filter((dress) => (category === "Todas" || dress.category === category) && `${dress.name} ${dress.color} ${dress.description}`.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es"))), [dresses, query, category]);
  const featured = dresses[0];

  return <div className="public-site">
    <header className="public-header">
      <Brand />
      <nav className="public-links" aria-label="Navegación principal"><a href="#coleccion">La colección</a><a href="#atelier">El atelier</a></nav>
      <Link to="/admin/login" className="owner-link"><LockKeyhole size={16} strokeWidth={1.8} /> Acceso privado</Link>
    </header>

    <main>
      <section className="landing-hero">
        <div className="landing-copy">
          <span className="kicker"><i /> VESTUARIO PARA ESTUDIOS Y FOTÓGRAFOS</span>
          <h1>Un día para<br />recordar <em>siempre.</em></h1>
          <p>Servicio de vestuario para profesionales de fotografía: vestidos de quinceañera para sesiones en estudio o exterior, siempre con uso supervisado.</p>
          <div className="hero-buttons"><a href="#coleccion" className="button button-dark">Explorar la colección <ArrowRight size={17} /></a><span>Sesiones desde <strong>{formatMoney(tariffFor(featured, "interior").price)}</strong></span></div>
          <div className="hero-assurance"><span><CircleCheck size={17} /> Prueba en el atelier</span><span><Sparkles size={17} /> Atención personal</span></div>
        </div>
        <div className="landing-art">
          <div className="landing-photo"><img src={featured?.images?.[0] || FALLBACK_IMAGE} alt={featured ? `${featured.name}, vestido de quinceañera` : "Vestido de quinceañera"} /><span className="photo-edition">COLECCIÓN<br />2026</span></div>
          <span className="photo-caption">{featured ? `${featured.name} · ${featured.color}` : "UNA NUEVA HISTORIA"}</span>
        </div>
        <span className="hero-side-note">TUL EN FOCO · VESTUARIO PARA SESIONES</span>
      </section>

      <section className="collection-section" id="coleccion">
        <div className="section-heading">
          <div><span className="kicker"><i /> NUESTRA SELECCIÓN</span><h2>Tu historia. <em>Tu vestido.</em></h2></div>
          <p>Una colección profesional para que<br />cada producción tenga una pieza especial.</p>
        </div>
        <div className="collection-tools"><label className="search-field"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o color" /></label><label className="category-filter"><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>Todas</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><span>{loading ? "Cargando colección…" : `${filtered.length} ${filtered.length === 1 ? "vestido" : "vestidos"}`}</span></div>
        {notice && <div className="inline-error">{notice}</div>}
        {loading ? <div className="loading-card">Preparando la colección…</div> : filtered.length ? <div className="public-dress-grid">{filtered.map((dress) => <PublicDressCard key={dress.id} dress={dress} onOpen={() => setSelected(dress)} onBook={() => setBookingDress(dress)} />)}</div> : <div className="empty-public"><Shirt size={31} /><strong>Estamos preparando nuevas piezas.</strong><span>Vuelve pronto para descubrir la colección.</span></div>}
      </section>

      <section className="atelier-strip" id="atelier"><span className="strip-icon"><Sparkles size={22} /></span><div><span className="kicker">SERVICIO PROFESIONAL · USO SUPERVISADO</span><h2>Un vestido especial para una historia irrepetible.</h2></div><p>Pensado para estudios y fotógrafos profesionales. Coordinamos horario, duración y uso en interior o exterior; el vestido permanece bajo supervisión.</p>{featured && <button className="button button-outline" onClick={() => setBookingDress(featured)}>Consultar sesión <ArrowUpRight size={17} /></button>}</section>
    </main>
    <footer className="public-footer"><Brand /><span>Vestuario profesional para sesiones fotográficas.</span><span>© Tul en Foco</span></footer>

    {selected && <DressDetail dress={selected} onClose={() => setSelected(null)} onBook={() => { setBookingDress(selected); setSelected(null); }} />}
    {bookingDress && <PublicBookingModal dress={bookingDress} onClose={() => setBookingDress(null)} />}
  </div>;
}

function PublicDressCard({ dress, onOpen, onBook }) {
  return <article className="public-card">
    <button className="card-image-button" onClick={onOpen} aria-label={`Ver ${dress.name}`}><img src={dress.images?.[0] || FALLBACK_IMAGE} alt={dress.name} /><span className="card-view"><Eye size={16} /> Ver vestido</span></button>
    <div className="public-card-copy"><div className="card-meta"><span className="color-dot" style={{ "--swatch": colorSwatch(dress.color) }} /><span>{dress.color}</span><span className="category-chip">{dress.category}</span><span className="public-available"><i /> Disponible bajo consulta</span></div><button className="dress-title-button" onClick={onOpen}><h3>{dress.name}</h3><ArrowUpRight size={19} /></button><p>{dress.description || "Una pieza especial para una celebración inolvidable."}</p><div className="card-footer"><strong>Interior {displayTariff(dress, "interior")} <small>· 30 min</small><br />Exterior {displayTariff(dress, "exterior")} <small>· hasta 2 h</small></strong><button onClick={onBook} className="card-cta">Consultar <ArrowRight size={16} /></button></div></div>
  </article>;
}

function colorSwatch(color = "") {
  const value = color.toLocaleLowerCase("es");
  if (value.includes("azul")) return "#516f91";
  if (value.includes("rojo") || value.includes("burdeos")) return "#8b3e49";
  if (value.includes("verde")) return "#66806e";
  if (value.includes("dorado") || value.includes("oro")) return "#b89a52";
  if (value.includes("rosa")) return "#bb8790";
  if (value.includes("negro")) return "#393438";
  if (value.includes("blanco") || value.includes("marfil")) return "#d7cdb9";
  return "#8b8170";
}

function DressDetail({ dress, onClose, onBook }) {
  const [imageIndex, setImageIndex] = useState(0);
  const images = dress.images?.length ? dress.images : [FALLBACK_IMAGE];
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="dress-detail-modal" role="dialog" aria-modal="true" aria-label={`Ficha de ${dress.name}`}>
      <button className="close-button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button>
      <div className="detail-gallery"><img className="detail-main-image" src={images[imageIndex]} alt={`${dress.name}, foto ${imageIndex + 1}`} /><div className="detail-thumbnails">{images.map((image, index) => <button key={image} className={index === imageIndex ? "selected" : ""} onClick={() => setImageIndex(index)} aria-label={`Ver foto ${index + 1}`}><img src={image} alt="" /></button>)}</div></div>
      <div className="detail-copy"><span className="kicker"><i /> {dress.category} · {dress.color}</span><h2>{dress.name}</h2><p>{dress.description}</p><div className="detail-facts"><div><span>TALLA</span><strong>{dress.sizeLabel || "A consultar"}</strong></div><div><span>AJUSTE</span><strong>{dress.sizeRange || "Consulta en el atelier"}</strong></div></div>{dress.id === "aurora-rose" && <SizeGuide />}
        <div className="detail-price"><div><span>SESIÓN EN INTERIOR</span><strong>{formatMoney(tariffFor(dress, "interior").price)}</strong><small>IVA incl. · 30 min; +{formatMoney(tariffFor(dress, "interior").extraPrice)} por cada 30 min más</small></div><div className="additional-price"><span>Sesión en exterior</span><strong>{formatMoney(tariffFor(dress, "exterior").price)} <small>/ hasta 2 h</small></strong><small>IVA incl. · +{formatMoney(tariffFor(dress, "exterior").extraPrice)} por cada hora más</small></div></div>
        <button className="button button-dark button-wide" onClick={onBook}>Consultar sesión supervisada <ArrowUpRight size={18} /></button><span className="detail-note"><LockKeyhole size={14} /> El vestido permanece bajo supervisión del equipo fotográfico</span>
      </div>
    </section>
  </div>;
}

function SizeGuide() {
  return <details className="size-guide"><summary>Guía de tallas y medidas <ChevronDown size={16} /></summary><div className="size-table-wrap"><table><thead><tr><th>Medidas (cm)</th><th>US 6 · EU 36</th><th>US 8 · EU 38</th><th>US 10 · EU 40</th></tr></thead><tbody><tr><th>Pecho</th><td>88</td><td>90</td><td>93</td></tr><tr><th>Cintura</th><td>70</td><td>72</td><td>75</td></tr><tr><th>Cadera</th><td>96</td><td>98</td><td>101</td></tr><tr><th>Largo</th><td>150</td><td>150</td><td>155</td></tr></tbody></table></div><p>Tabla orientativa del fabricante. La talla base es US 8 / EU 38 y el vestido se ajusta de US 6 a 10 / EU 36–40. Confirma las medidas exactas en el atelier.</p><a href="/images/vestidos/aurora-rose/guia-tallas.png" target="_blank" rel="noreferrer">Consultar imagen original del fabricante ↗</a></details>;
}

function PublicBookingModal({ dress, onClose }) {
  const [sessionType, setSessionType] = useState("exterior");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [startTime, setStartTime] = useState("10:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/api/public/requests", { method: "POST", body: JSON.stringify({
        dressId: dress.id,
        studioName: form.get("studioName"),
        contactName: form.get("contactName"),
        phone: form.get("phone"),
        date: form.get("date"),
        startTime,
        sessionType,
        durationMinutes,
      }) });
      setSuccess(result.message);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="form-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title"><button className="close-button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button>{success ? <div className="success-state"><span className="success-icon"><CircleCheck size={31} /></span><span className="kicker">SOLICITUD REGISTRADA</span><h2 id="booking-title">Gracias por escribirnos.</h2><p>{success}</p><button className="button button-dark" onClick={onClose}>Volver a la colección</button></div> : <><span className="kicker"><i /> EXCLUSIVO PARA PROFESIONALES</span><h2 id="booking-title">Coordina una sesión.</h2><p>Indica quién realizará la sesión y cómo se utilizará <strong>{dress.name}</strong>. El vestido estará supervisado por el equipo fotográfico.</p><form onSubmit={submit} className="form-stack">
    <label>Estudio fotográfico o fotógrafo<input name="studioName" minLength="2" maxLength="120" required placeholder="Nombre del estudio o profesional" /></label>
    <label>Persona de contacto<input name="contactName" maxLength="100" placeholder="Nombre de quien coordina" /></label>
    <div className="form-columns"><label>Tipo de sesión<select value={sessionType} onChange={(event) => { const next = event.target.value; setSessionType(next); setDurationMinutes(tariffFor(dress, next).includedMinutes); }}><option value="interior">Interior · desde {formatMoney(tariffFor(dress, "interior").price)} / {durationLabel(tariffFor(dress, "interior").includedMinutes)}</option><option value="exterior">Exterior · desde {formatMoney(tariffFor(dress, "exterior").price)} / {durationLabel(tariffFor(dress, "exterior").includedMinutes)}</option></select></label><label>Duración<select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{durationOptions(sessionType).map((value) => <option key={value} value={value}>{durationLabel(value)}</option>)}</select></label></div>
    <div className="form-columns"><label>Fecha de la sesión<input name="date" type="date" min={localDate()} required /></label><label>Hora de inicio<select value={startTime} onChange={(event) => setStartTime(event.target.value)}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</select></label></div>
    <label>Teléfono de contacto<input name="phone" type="tel" maxLength="40" required placeholder="+34 600 000 000" /></label>
    <div className="modal-total"><span>Precio estimado · {typeLabel(sessionType)} · {startTime}–{addMinutesToTime(startTime, durationMinutes)} · IVA incluido</span><strong>{formatMoney(priceFor(dress, sessionType, durationMinutes))}</strong></div>
    {error && <div className="form-error"><Info size={16} />{error}</div>}<button className="button button-dark button-wide" disabled={busy}>{busy ? "Enviando…" : "Solicitar disponibilidad"}<ArrowUpRight size={17} /></button><small className="form-footnote">La solicitud no confirma la cita. Solo se bloqueará el horario solicitado; otro profesional puede reservar el mismo vestido ese día si no existe solapamiento.</small></form></>}</section></div>;
}

function AdminLogin() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("/api/auth/me").then(() => navigate("/admin", { replace: true })).catch(() => setChecking(false)); }, [navigate]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); navigate("/admin", { replace: true }); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  if (checking) return <div className="center-loading">Preparando acceso privado…</div>;
  return <main className="login-page"><div className="login-aside"><Brand light /><div className="login-art"><img src={FALLBACK_IMAGE} alt="Vestido Aurora Rosé" /><span>La belleza está<br />en los detalles.</span></div><p>Una colección cuidada para momentos que merecen ser recordados.</p></div><section className="login-panel"><Link className="back-public" to="/"><ArrowDownRight size={16} /> Volver a la colección pública</Link><div className="login-form-wrap"><span className="login-lock"><LockKeyhole size={21} /></span><span className="kicker">ZONA PRIVADA</span><h1>Bienvenido de vuelta.</h1><p>Inicia sesión para gestionar vestidos, reservas y finanzas del atelier.</p><form onSubmit={submit} className="form-stack"><label>Correo electrónico<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu correo" /></label><label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tu contraseña" /></label>{error && <div className="form-error"><Info size={16} />{error}</div>}<button className="button button-dark button-wide" disabled={busy}>{busy ? "Entrando…" : "Entrar al atelier"}<ArrowRight size={17} /></button></form><span className="login-safety"><LockKeyhole size={14} /> Acceso protegido con sesión privada</span></div><footer>TUL EN FOCO · GESTIÓN PRIVADA</footer></section></main>;
}

function AdminGate() {
  const [state, setState] = useState("checking");
  const [user, setUser] = useState(null);
  useEffect(() => { api("/api/auth/me").then((data) => { setUser(data.user); setState("ready"); }).catch(() => setState("logged-out")); }, []);
  if (state === "checking") return <div className="center-loading">Comprobando sesión privada…</div>;
  if (state === "logged-out") return <Navigate to="/admin/login" replace />;
  return <AdminShell user={user} />;
}

function AdminShell({ user }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  const [requestNotice, setRequestNotice] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    let previous = null;
    let active = true;
    const checkRequests = () => api("/api/admin/overview").then((data) => {
      if (!active) return;
      const next = Number(data.requests || 0);
      if (previous !== null && next > previous) {
        const added = next - previous;
        setRequestNotice(added === 1 ? "Ha llegado una nueva solicitud de sesión." : `Han llegado ${added} nuevas solicitudes de sesión.`);
      }
      previous = next;
      setRequestCount(next);
    }).catch(() => {});
    checkRequests();
    const timer = window.setInterval(checkRequests, 60000);
    const handleVisibility = () => { if (document.visibilityState === "visible") checkRequests(); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", handleVisibility); };
  }, []);
  useEffect(() => {
    if (!requestNotice) return undefined;
    const timer = window.setTimeout(() => setRequestNotice(""), 7000);
    return () => window.clearTimeout(timer);
  }, [requestNotice]);
  async function logout() {
    setLoggingOut(true);
    try { await api("/api/auth/logout", { method: "POST" }); } finally { navigate("/admin/login", { replace: true }); }
  }
  const links = [
    { to: "/admin/resumen", label: "Resumen", icon: LayoutDashboard },
    { to: "/admin/vestidos", label: "Vestidos", icon: Shirt },
    { to: "/admin/reservas", label: "Reservas", icon: CalendarDays, badge: requestCount },
    { to: "/admin/finanzas", label: "Finanzas", icon: ChartPieIcon },
  ];
  return <div className="admin-app">
    <aside className={`admin-sidebar ${menuOpen ? "sidebar-open" : ""}`}><Brand light /><span className="sidebar-label">GESTIÓN DEL ATELIER</span><nav>{links.map(({ to, label, icon: Icon, badge }) => <NavLink key={to} to={to} onClick={() => setMenuOpen(false)} className={({ isActive }) => `admin-nav-link ${isActive ? "active" : ""}`}><Icon size={19} strokeWidth={1.9} /><span>{label}</span>{badge > 0 && <strong className="nav-notification-badge" aria-label={`${badge} solicitudes pendientes`}>{badge > 99 ? "99+" : badge}</strong>}</NavLink>)}</nav><div className="sidebar-spacer" /><Link to="/" className="view-shop-link"><Eye size={18} /> Vista pública <ArrowUpRight size={15} /></Link><div className="admin-user"><span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span><div><strong>Administrador</strong><small>{user.email}</small></div><button onClick={logout} disabled={loggingOut} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={17} /></button></div></aside>
    <div className="admin-main"><header className="admin-topbar"><button className="mobile-nav-toggle" onClick={() => setMenuOpen((value) => !value)} aria-label="Abrir navegación"><Menu size={21} /></button><div className="admin-breadcrumb"><span>Tul en Foco</span><span>/</span><strong>{adminPageLabel(useLocation().pathname)}</strong></div><div className="admin-top-right"><span><i /> Sesión protegida</span><span className="today-date">{new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" }).format(new Date())}</span></div></header><div className="admin-content"><Outlet /></div></div>
    {requestNotice && <Link to="/admin/reservas" className="request-toast"><CalendarDays size={18} /><span><strong>Nueva solicitud</strong><small>{requestNotice}</small></span><ArrowRight size={16} /></Link>}
  </div>;
}

function ChartPieIcon(props) { return <CircleDollarSign {...props} />; }
function adminPageLabel(path) { return path.endsWith("vestidos") ? "Vestidos" : path.endsWith("reservas") ? "Reservas" : path.endsWith("finanzas") ? "Finanzas" : "Resumen"; }

function PageHeading({ eyebrow, title, emphasis, subtitle, action }) {
  return <div className="admin-page-heading"><div><span className="kicker">{eyebrow}</span><h1>{title} <em>{emphasis}</em></h1><p>{subtitle}</p></div>{action}</div>;
}

function StatCard({ icon: Icon, label, value, detail, tone = "" }) {
  return <article className={`stat-tile ${tone}`}><div className="stat-tile-top"><span>{label}</span><span className="stat-tile-icon"><Icon size={19} strokeWidth={1.8} /></span></div><strong>{value}</strong><small>{detail}</small></article>;
}

function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [dresses, setDresses] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [sessionType, setSessionType] = useState("exterior");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [error, setError] = useState("");
  const [showRental, setShowRental] = useState(false);
  const refresh = () => Promise.all([api("/api/admin/overview"), api("/api/admin/dresses"), api("/api/admin/bookings")]).then(([summary, dressList, bookingList]) => { setOverview(summary); setDresses(dressList.dresses.filter((dress) => dress.active)); setBookings(bookingList.bookings); }).catch((caught) => setError(caught.message));
  useEffect(() => { refresh(); }, []);
  const first = dresses.find(isPriced) || dresses[0];
  const settings = overview?.settings || DEFAULT_SETTINGS;
  const projected = first && isPriced(first) ? economicsFor(first, sessionType, durationMinutes, settings) : null;
  return <>
    <PageHeading eyebrow={new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()).toLocaleUpperCase("es")} title="El atelier," emphasis="en armonía." subtitle="Una visión clara de la colección, las sesiones fotográficas y las finanzas." action={<button className="button button-dark" onClick={() => setShowRental(true)}><Plus size={18} /> Registrar sesión</button>} />
    {error && <div className="inline-error">{error}</div>}
    <div className="stats-grid-admin"><StatCard icon={Shirt} label="Vestidos activos" value={overview ? String(overview.dresses).padStart(2, "0") : "—"} detail="Piezas para sesiones supervisadas" /><StatCard icon={Wallet} label="Inversión en colección" value={overview ? formatMoney(overview.investment) : "—"} detail="Coste de compra acumulado" /><StatCard icon={CalendarCheck} label="Sesiones realizadas" value={overview ? String(overview.completedRentals).padStart(2, "0") : "—"} detail={`${overview?.requests ?? 0} solicitudes pendientes`} /><StatCard icon={TrendingUp} label="Ingresos cobrados" value={overview ? formatMoney(overview.grossRevenue) : "—"} detail={overview?.outstandingRevenue > 0 ? `${formatMoney(overview.outstandingRevenue)} realizado pendiente de cobro` : "Sesiones realizadas y cobradas"} tone="stat-highlight" /></div>
    <div className="admin-dashboard-grid">
      <section className="admin-panel featured-admin-panel"><div className="panel-title-row"><div><span className="kicker">LA COLECCIÓN</span><h2>Un armario lleno de posibilidades.</h2></div><Link to="/admin/vestidos" className="subtle-link">Ver vestidos <ArrowRight size={16} /></Link></div>{first ? <div className="admin-feature-card"><img src={first.images?.[0] || FALLBACK_IMAGE} alt={first.name} /><div className="admin-feature-copy"><span className="availability-label"><i /> {first.category}</span><h3>{first.name}</h3><p>{first.color} · {first.sizeLabel || "Talla pendiente"}</p><div><span>Compra <strong>{formatMoney(first.purchaseCost)}</strong></span><span>Interior <strong>{displayTariff(first, "interior")} <small>/ 30 min</small></strong></span><span>Exterior <strong>{displayTariff(first, "exterior")} <small>/ 2 h</small></strong></span></div><Link to="/admin/vestidos">Abrir ficha <ArrowUpRight size={15} /></Link></div></div> : <div className="empty-admin"><Package size={28} /><strong>Añade la primera pieza</strong><Link to="/admin/vestidos">Ir al armario <ArrowRight size={15} /></Link></div>}</section>
      <section className="admin-panel split-panel"><div className="panel-title-row"><div><span className="kicker">PROYECCIÓN POR SESIÓN</span><h2>Un reparto claro.</h2></div><Sparkles className="gold-icon" size={21} /></div>{first && projected ? <><div className="projection-control"><label htmlFor="projection-type">Tipo de sesión</label><select id="projection-type" value={sessionType} onChange={(event) => { const next = event.target.value; setSessionType(next); setDurationMinutes(tariffFor(first, next).includedMinutes); }}><option value="interior">Interior</option><option value="exterior">Exterior</option></select></div><div className="projection-control"><label htmlFor="projection-hours">Duración estimada</label><select id="projection-hours" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{durationOptions(sessionType).map((value) => <option key={value} value={value}>{durationLabel(value)}</option>)}</select></div><div className="projection-summary"><div className="donut-chart"><div><strong>50<small>%</small></strong><span>para cada uno</span></div></div><div className="projection-legend"><div><i className="legend-partner" /><span>Tu beneficio</span><strong>{formatMoney(projected.share)}</strong></div><div><i className="legend-wife" /><span>Beneficio esposa</span><strong>{formatMoney(projected.share)}</strong></div><div><i className="legend-care" /><span>Fondo cuidado</span><strong>{formatMoney(projected.maintenance)}</strong></div></div></div><div className="calculation-note"><span>De {formatMoney(projected.gross)} cobrados · {typeLabel(sessionType)}</span><small>{formatMoney(projected.vat)} IVA · {formatMoney(projected.helper)} ayudante · {formatMoney(projected.maintenance)} mantenimiento</small></div><Link className="break-even-callout" to="/admin/finanzas"><span className="break-even-star"><Sparkles size={19} /></span><span><strong>Recuperación estimada según tus sesiones</strong><small>Inversión de {formatMoney(first.purchaseCost)} · proyección con {durationLabel(durationMinutes)}</small></span><ArrowUpRight size={17} /></Link></> : <div className="empty-admin">{first ? "Completa las tarifas de esta pieza para proyectar su rendimiento." : "Añade un vestido para ver su proyección."}</div>}</section>
    </div>
    <section className="admin-panel activity-panel"><div className="panel-title-row"><div><span className="kicker">AGENDA DEL ATELIER</span><h2>Solicitudes y actividad reciente.</h2></div><Link to="/admin/reservas" className="subtle-link">Ver agenda <ArrowRight size={16} /></Link></div>{bookings.length ? <div className="compact-bookings">{bookings.slice(0, 4).map((booking) => <BookingLine key={booking.id} booking={booking} />)}</div> : <div className="empty-activity-admin"><span className="activity-mark"><CalendarDays size={21} /></span><div><strong>La agenda está lista para su primera cita.</strong><p>Las solicitudes que recibas desde la web aparecerán aquí.</p></div><Link to="/admin/reservas">Abrir reservas <ArrowRight size={15} /></Link></div>}</section>
    {showRental && <AdminBookingModal dresses={dresses.filter(isPriced)} onClose={() => setShowRental(false)} onSaved={() => { setShowRental(false); refresh(); }} />}
  </>;
}

function BookingLine({ booking }) {
  const state = { requested: "Solicitud", confirmed: "Confirmada", completed: "Realizada", cancelled: "Cancelada" }[booking.status];
  const payment = booking.status === "completed" ? ` · ${paymentLabel(booking.paymentStatus)}` : "";
  return <div className="booking-line"><span className={`booking-status-dot ${booking.status}`} /><div><strong>{booking.studioName || booking.name}</strong><small>{booking.dressName} · {typeLabel(booking.sessionType)} · {state}{payment}</small></div><span>{formatDate(booking.date)} · {bookingTimeLabel(booking)}</span><strong>{formatMoney(booking.gross)}</strong></div>;
}

function AdminDresses() {
  const [dresses, setDresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState("");
  const load = () => api("/api/admin/dresses").then((data) => setDresses(data.dresses)).catch((caught) => setError(caught.message)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  const filtered = dresses.filter((dress) => `${dress.name} ${dress.color} ${dress.category}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")));
  async function toggleActive(dress) {
    setBusyId(dress.id); setError("");
    try { await api(`/api/admin/dresses/${dress.id}`, { method: "PATCH", body: JSON.stringify({ active: !dress.active }) }); await load(); }
    catch (caught) { setError(caught.message); }
    finally { setBusyId(""); }
  }
  return <>
    <PageHeading eyebrow="INVENTARIO DEL ATELIER" title="Cada vestido" emphasis="cuenta una historia." subtitle="Gestiona fotos, tallas, tarifas y coste de compra de cada pieza." action={<button className="button button-dark" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={18} /> Añadir vestido</button>} />
    {error && <div className="inline-error">{error}</div>}
    <div className="inventory-toolbar"><label className="search-field"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, color o categoría" /></label><span>{dresses.filter((dress) => dress.active).length} vestidos activos · {dresses.filter((dress) => dress.active && !isPriced(dress)).length} con tarifa pendiente</span></div>
    {loading ? <div className="loading-card">Cargando colección privada…</div> : filtered.length ? <div className="admin-dress-grid">{filtered.map((dress) => <article className={`inventory-card ${dress.active ? "" : "archived"}`} key={dress.id}>
      <InventoryGallery dress={dress} />
      <div className="inventory-copy">
        <div className="inventory-meta"><span className="inventory-color"><span className="color-dot" style={{ "--swatch": colorSwatch(dress.color) }} />{dress.color}</span><span className="category-chip">{dress.category}</span><span className={`inventory-availability ${dress.active ? "" : "inactive"}`}><i />{dress.active ? "Activo" : "Archivado"}</span></div>
        <h2>{dress.name}</h2>
        <p>{dress.description || "Sin descripción todavía."}</p>
        <div className="inventory-price-summary"><div><span>SESIÓN INTERIOR</span><strong>{displayTariff(dress, "interior")}</strong><small>· 30 min</small></div><div><span>SESIÓN EXTERIOR</span><strong>{displayTariff(dress, "exterior")}</strong><small>· hasta 2 h</small></div></div>
        <div className="inventory-owner-row"><span><LockKeyhole size={13} /> Coste de compra</span><strong>{formatMoney(dress.purchaseCost)}</strong></div>
        <div className="inventory-size">{dress.sizeLabel || "Talla pendiente"}{dress.sizeRange ? ` · Ajustable ${dress.sizeRange}` : ""}</div>
        <div className="inventory-actions"><button className="inventory-edit-action" onClick={() => { setEditing(dress); setShowForm(true); }} aria-label={`Editar ${dress.name}`}>Editar ficha <ArrowRight size={16} /></button><button className="inventory-archive-action" disabled={busyId === dress.id} onClick={() => toggleActive(dress)}>{dress.active ? "Archivar" : "Reactivar"}</button></div>
      </div>
    </article>)}</div> : <div className="empty-admin"><Package size={31} /><strong>{search ? "No encontramos vestidos con esa búsqueda." : "Aún no hay vestidos en el armario."}</strong><button className="button button-dark" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={17} /> Añadir vestido</button></div>}
    {showForm && <DressForm initial={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
  </>;
}

function InventoryGallery({ dress }) {
  const images = dress.images?.length ? dress.images : [FALLBACK_IMAGE];
  const [activeImage, setActiveImage] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowLeft") setActiveImage((index) => (index - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") setActiveImage((index) => (index + 1) % images.length);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen, images.length]);
  return <div className="inventory-gallery">
    <div className="inventory-photo"><button type="button" className="inventory-preview-button" onClick={() => setLightboxOpen(true)} aria-label={`Ver ${dress.name} y todas sus fotos`}><img src={images[activeImage]} alt={`${dress.name}, foto ${activeImage + 1}`} /></button><span className="image-count"><ImagePlus size={14} /> {dress.images?.length || 0}</span>
      {dress.images?.length > 1 && <div className="inventory-thumbnails" aria-label={`Fotos de ${dress.name}`}>
        {dress.images.map((image, index) => <button type="button" key={`${image}-${index}`} className={`inventory-thumbnail ${index === activeImage ? "selected" : ""}`} onClick={() => setActiveImage(index)} aria-label={`Mostrar foto ${index + 1} de ${dress.name}`} aria-pressed={index === activeImage}><img src={image} alt="" /></button>)}
      </div>}
      <button type="button" className="inventory-card-view" onClick={() => setLightboxOpen(true)}><Eye size={16} /> Ver vestido</button>
    </div>
    {lightboxOpen && createPortal(<InventoryDressPreview dress={dress} images={images} activeImage={activeImage} setActiveImage={setActiveImage} onClose={() => setLightboxOpen(false)} />, document.body)}
  </div>;
}

function InventoryDressPreview({ dress, images, activeImage, setActiveImage, onClose }) {
  return <div className="modal-backdrop inventory-preview-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="dress-detail-modal inventory-preview-modal" role="dialog" aria-modal="true" aria-label={`Ficha privada de ${dress.name}`}>
      <button type="button" className="close-button" onClick={onClose} aria-label="Cerrar ficha"><X size={21} /></button>
      <div className="detail-gallery inventory-detail-gallery">
        <img className="detail-main-image inventory-preview-main-image" src={images[activeImage]} alt={`${dress.name}, foto ${activeImage + 1}`} />
        {images.length > 1 && <div className="detail-thumbnails">{images.map((image, index) => <button type="button" key={`${image}-${index}`} className={index === activeImage ? "selected" : ""} onClick={() => setActiveImage(index)} aria-label={`Ver foto ${index + 1}`} aria-pressed={index === activeImage}><img src={image} alt="" /></button>)}</div>}
      </div>
      <div className="detail-copy inventory-preview-copy">
        <span className="kicker"><i /> {dress.category} · {dress.color}</span>
        <h2>{dress.name}</h2>
        <p>{dress.description || "Sin descripción todavía."}</p>
        <div className="detail-facts"><div><span>TALLA</span><strong>{dress.sizeLabel || "Pendiente"}</strong></div><div><span>AJUSTE</span><strong>{dress.sizeRange || "Sin especificar"}</strong></div></div>
        {dress.id === "aurora-rose" && <SizeGuide />}
        <div className="inventory-preview-prices"><span className="kicker"><i /> INFORMACIÓN INTERNA</span><div className="inventory-preview-price-grid">
          <div><span>COSTE DE COMPRA</span><strong>{formatMoney(dress.purchaseCost)}</strong></div>
          <div><span>SESIÓN EN INTERIOR</span><strong>{displayTariff(dress, "interior")}</strong><small>30 min iniciales</small></div>
          <div><span>SESIÓN EN EXTERIOR</span><strong>{displayTariff(dress, "exterior")}</strong><small>Hasta 2 horas</small></div>
        </div></div>
        <div className={`inventory-preview-status ${dress.active ? "active" : "inactive"}`}><i />{dress.active ? "Vestido activo en la colección" : "Vestido archivado"}<span>{images.length} {images.length === 1 ? "foto" : "fotos"}</span></div>
      </div>
    </section>
  </div>;
}

function DressForm({ initial, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState(initial?.category || "Estándar");
  const [existingImages, setExistingImages] = useState(initial?.images || []);
  function changeCategory(event) {
    const next = event.target.value;
    const form = event.currentTarget.form;
    const prices = { interiorPrice: "230", interiorExtraPrice: "25", interiorMaintenance: "15", exteriorPrice: "350", exteriorExtraPrice: "25", exteriorMaintenance: "30" };
    for (const [field, premiumValue] of Object.entries(prices)) {
      const input = form.elements.namedItem(field);
      if (next === "Premium" && !input.value) input.value = premiumValue;
      if (category === "Premium" && next !== "Premium" && input.value === premiumValue) input.value = "";
    }
    setCategory(next);
  }
  function moveImage(index, direction) {
    setExistingImages((images) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= images.length) return images;
      const copy = [...images];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    if (initial) data.set("existingImages", JSON.stringify(existingImages));
    try {
      if (initial) await api(`/api/admin/dresses/${initial.id}`, { method: "PATCH", body: data });
      else await api("/api/admin/dresses", { method: "POST", body: data });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="form-modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="dress-form-title"><button className="close-button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button><span className="kicker"><i /> ARMARIO PRIVADO</span><h2 id="dress-form-title">{initial ? "Editar vestido." : "Una nueva pieza."}</h2><p>El coste de compra y los importes internos solo se muestran en el área privada.</p><form onSubmit={submit} className="form-stack">
    <div className="form-columns"><label>Nombre<input name="name" required maxLength="100" defaultValue={initial?.name || ""} placeholder="Ej. Aurora Rosé" /></label><label>Color<input name="color" required maxLength="60" defaultValue={initial?.color || ""} placeholder="Ej. azul noche" /></label></div>
    <label>Categoría<select name="category" value={category} onChange={changeCategory}><option>Premium</option><option>Estándar</option><option>Económico</option><option>Otra</option></select></label>
    <label>Descripción<textarea name="description" maxLength="1000" defaultValue={initial?.description || ""} rows="3" placeholder="Corte, tejido, detalles especiales…" /></label>
    <div className="form-columns"><label>Talla base<input name="sizeLabel" maxLength="80" defaultValue={initial?.sizeLabel || ""} placeholder="Ej. US 8 · EU 38" /></label><label>Rango ajustable<input name="sizeRange" maxLength="80" defaultValue={initial?.sizeRange || ""} placeholder="Ej. US 6–10 · EU 36–40" /></label></div>
    <h3>Tarifa de sesión en interior</h3>
    <div className="form-columns"><label>Precio inicial (€ IVA incl.)<input name="interiorPrice" type="number" min="0.01" step="0.01" placeholder="Por definir" defaultValue={initial ? (Number(tariffFor(initial, "interior").price) || "") : ""} /></label><label>Incluye (minutos)<input value="30" disabled /></label></div>
    <div className="form-columns"><label>Por cada 30 min adicionales (€)<input name="interiorExtraPrice" type="number" min="0.01" step="0.01" placeholder="Por definir" defaultValue={initial ? (Number(tariffFor(initial, "interior").extraPrice) || "") : ""} /></label><label>Fondo de mantenimiento (€)<input name="interiorMaintenance" type="number" min="0.01" step="0.01" placeholder="Por definir" defaultValue={initial ? (Number(tariffFor(initial, "interior").maintenance) || "") : ""} /></label></div>
    <h3>Tarifa de sesión en exterior</h3>
    <div className="form-columns"><label>Precio inicial (€ IVA incl.)<input name="exteriorPrice" type="number" min="0.01" step="0.01" placeholder="Por definir" defaultValue={initial ? (Number(tariffFor(initial, "exterior").price) || "") : ""} /></label><label>Incluye (minutos)<input value="120" disabled /></label></div>
    <div className="form-columns"><label>Por cada hora adicional (€)<input name="exteriorExtraPrice" type="number" min="0.01" step="0.01" placeholder="Por definir" defaultValue={initial ? (Number(tariffFor(initial, "exterior").extraPrice) || "") : ""} /></label><label>Fondo de mantenimiento (€)<input name="exteriorMaintenance" type="number" min="0.01" step="0.01" placeholder="Por definir" defaultValue={initial ? (Number(tariffFor(initial, "exterior").maintenance) || "") : ""} /></label></div>
    <small>Las tarifas pueden quedar pendientes. La pieza solo aparecerá en el catálogo público cuando tenga todas las tarifas definidas para interior y exterior.</small>
    <label>Coste de compra (€)<input name="purchaseCost" type="number" min="0" step="0.01" required defaultValue={initial?.purchaseCost ?? ""} /></label>
    {initial && <div className="photo-manager"><div className="photo-manager-heading"><strong>Galería actual</strong><span>La primera foto es la portada.</span></div>{existingImages.length ? <div className="photo-manager-grid">{existingImages.map((image, index) => <div className="photo-manager-item" key={image}><img src={image} alt={`Foto ${index + 1} de ${initial.name}`} /><span>{index === 0 ? "PORTADA" : `#${index + 1}`}</span><div><button type="button" disabled={index === 0} onClick={() => moveImage(index, -1)} aria-label="Mover foto a la izquierda">←</button><button type="button" disabled={index === existingImages.length - 1} onClick={() => moveImage(index, 1)} aria-label="Mover foto a la derecha">→</button><button type="button" className="remove-photo" onClick={() => setExistingImages((images) => images.filter((_, imageIndex) => imageIndex !== index))}>Quitar</button></div></div>)}</div> : <div className="photo-manager-empty">Has quitado todas las fotos actuales. Añade al menos una nueva antes de guardar.</div>}</div>}
    <label className="upload-control"><ImagePlus size={20} /><span><strong>{initial ? "Añadir fotos a la galería" : "Fotos del vestido"}</strong><small>JPG, PNG o WebP · máximo 8 MB por foto · hasta 8 imágenes nuevas</small></span><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple required={!initial} /></label>
    {error && <div className="form-error"><Info size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancelar</button><button className="button button-dark" disabled={busy}>{busy ? "Guardando…" : initial ? "Guardar cambios" : "Guardar vestido"}<Check size={17} /></button></div>
  </form></section></div>;
}

function AdminBookings() {
  const [bookings, setBookings] = useState([]);
  const [dresses, setDresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null);
  const [pending, setPending] = useState("");
  const load = () => Promise.all([api("/api/admin/bookings"), api("/api/admin/dresses")]).then(([bookingData, dressData]) => {
    setBookings(bookingData.bookings);
    setDresses(dressData.dresses);
  }).catch((caught) => setError(caught.message)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  async function changeStatus(booking, status) {
    setPending(booking.id); setError("");
    try { await api(`/api/admin/bookings/${booking.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); await load(); }
    catch (caught) { setError(caught.message); }
    finally { setPending(""); }
  }
  async function markPaid(booking) {
    setPending(booking.id); setError("");
    try { await api(`/api/admin/bookings/${booking.id}`, { method: "PATCH", body: JSON.stringify({ paymentStatus: "paid" }) }); await load(); }
    catch (caught) { setError(caught.message); }
    finally { setPending(""); }
  }
  const requests = bookings.filter((booking) => booking.status === "requested").length;
  const confirmed = bookings.filter((booking) => booking.status === "confirmed").length;
  const paidIncome = bookings.filter((booking) => booking.status === "completed" && booking.paymentStatus === "paid").reduce((sum, booking) => sum + Number(booking.gross || 0), 0);
  const outstanding = bookings.filter((booking) => booking.status === "completed" && booking.paymentStatus !== "paid").reduce((sum, booking) => sum + Number(booking.gross || 0), 0);
  const bookableDresses = dresses.filter((dress) => dress.active && isPriced(dress));
  return <>
    <PageHeading eyebrow="CALENDARIO DEL ATELIER" title="Citas y" emphasis="celebraciones." subtitle="Coordina horarios, solicitudes, sesiones realizadas y cobros." action={<button className="button button-dark" onClick={() => setShowModal(true)}><Plus size={18} /> Registrar sesión</button>} />
    {error && <div className="inline-error">{error}</div>}
    <div className="booking-stats"><StatCard icon={Clock3} label="Por revisar" value={String(requests).padStart(2, "0")} detail="Solicitudes de estudios" /><StatCard icon={CalendarCheck} label="Confirmadas" value={String(confirmed).padStart(2, "0")} detail="Próximas sesiones" /><StatCard icon={Banknote} label="Cobrado" value={formatMoney(paidIncome)} detail={outstanding > 0 ? `${formatMoney(outstanding)} pendiente de cobro` : "Sin cobros pendientes"} tone="stat-highlight" /></div>
    <section className="admin-panel agenda-panel"><div className="panel-title-row"><div><span className="kicker">AGENDA E HISTORIAL</span><h2>Sesiones fotográficas</h2></div><span className="table-counter">{bookings.length} registros</span></div>{loading ? <div className="loading-card">Cargando agenda…</div> : bookings.length ? <div className="booking-table"><div className="booking-table-head"><span>ESTUDIO / VESTIDO</span><span>FECHA / HORA</span><span>SESIÓN / TIEMPO</span><span>IMPORTE</span><span>ESTADO / ACCIONES</span></div>{bookings.map((booking) => <div className="booking-table-row" key={booking.id}><div className="booking-person"><strong>{booking.studioName || booking.name}</strong><small>{booking.contactName ? `${booking.contactName} · ` : ""}{booking.dressName} · {booking.phone || "Sin teléfono"}</small></div><span>{formatDate(booking.date)} · {bookingTimeLabel(booking)}</span><span>{typeLabel(booking.sessionType)} · {durationLabel(booking.durationMinutes)}</span><strong>{formatMoney(booking.gross)}</strong><div className="booking-actions"><StatusBadge status={booking.status} /><span className={`payment-badge ${booking.paymentStatus === "paid" ? "paid" : "pending"}`}>{paymentLabel(booking.paymentStatus)}</span><button className="small-action" disabled={pending === booking.id} onClick={() => setEditingBooking(booking)}>Editar</button>{booking.status === "requested" && <><button className="small-action confirm" disabled={pending === booking.id} onClick={() => changeStatus(booking, "confirmed")}><Check size={15} /> Confirmar</button><button className="small-action cancel" disabled={pending === booking.id} onClick={() => changeStatus(booking, "cancelled")} aria-label="Cancelar solicitud"><X size={16} /></button></>}{booking.status === "confirmed" && <><button className="small-action confirm" disabled={pending === booking.id} onClick={() => changeStatus(booking, "completed")}><Check size={15} /> Marcar realizada</button><button className="small-action cancel" disabled={pending === booking.id} onClick={() => changeStatus(booking, "cancelled")} aria-label="Cancelar solicitud"><X size={16} /></button></>}{booking.status === "completed" && booking.paymentStatus !== "paid" && <button className="small-action confirm" disabled={pending === booking.id} onClick={() => markPaid(booking)}><Banknote size={15} /> Marcar cobrada</button>}</div></div>)}</div> : <div className="empty-admin"><CalendarDays size={30} /><strong>La agenda está libre por ahora.</strong><span>Las solicitudes de estudios y fotógrafos aparecerán aquí.</span></div>}</section>
    <StudioProfiles bookings={bookings} />
    {showModal && <AdminBookingModal dresses={bookableDresses} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />}
    {editingBooking && <BookingEditModal booking={editingBooking} dresses={dresses} onClose={() => setEditingBooking(null)} onSaved={() => { setEditingBooking(null); load(); }} />}
  </>;
}

function BookingEditModal({ booking, dresses, onClose, onSaved }) {
  const [dressId, setDressId] = useState(booking.dressId);
  const [sessionType, setSessionType] = useState(booking.sessionType);
  const [durationMinutes, setDurationMinutes] = useState(booking.durationMinutes);
  const [startTime, setStartTime] = useState(booking.startTime || "10:00");
  const [paymentStatus, setPaymentStatus] = useState(booking.paymentStatus || "pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/admin/bookings/${booking.id}`, { method: "PATCH", body: JSON.stringify({
        dressId,
        studioName: form.get("studioName"),
        contactName: form.get("contactName"),
        phone: form.get("phone"),
        date: form.get("date"),
        startTime,
        sessionType,
        durationMinutes,
        paymentStatus,
        gross: form.get("gross"),
        helperCost: form.get("helperCost"),
        maintenance: form.get("maintenance"),
        notes: form.get("notes"),
      }) });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="form-modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="edit-booking-title"><button className="close-button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button><span className="kicker"><i /> CORRECCIÓN DE SESIÓN</span><h2 id="edit-booking-title">Editar registro.</h2><p>Corrige horario, duración, cobro e importes reales. Estos valores alimentan la cartera y los totales financieros.</p><form className="form-stack" onSubmit={submit}>
    <label>Vestido<select value={dressId} onChange={(event) => setDressId(event.target.value)}>{dresses.map((dress) => <option key={dress.id} value={dress.id}>{dress.name}{!dress.active ? " · archivado" : ""}</option>)}</select></label>
    <div className="form-columns"><label>Estudio / fotógrafo<input name="studioName" required defaultValue={booking.studioName || booking.name} /></label><label>Contacto<input name="contactName" defaultValue={booking.contactName || ""} /></label></div>
    <div className="form-columns"><label>Fecha<input name="date" type="date" required defaultValue={booking.date} /></label><label>Hora de inicio<select value={startTime} onChange={(event) => setStartTime(event.target.value)}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</select></label></div>
    <div className="form-columns"><label>Tipo<select value={sessionType} onChange={(event) => setSessionType(event.target.value)}><option value="interior">Interior</option><option value="exterior">Exterior</option></select></label><label>Duración<select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{durationOptions(sessionType).map((value) => <option key={value} value={value}>{durationLabel(value)}</option>)}</select></label></div>
    <div className="form-columns"><label>Teléfono<input name="phone" defaultValue={booking.phone || ""} /></label><label>Estado del cobro<select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}><option value="pending">Pendiente de cobro</option><option value="paid">Cobrada</option></select></label></div>
    <div className="form-columns"><label>Importe real cobrado (€)<input name="gross" type="number" min="0" step="0.01" required defaultValue={Number(booking.gross).toFixed(2)} /></label><label>Coste real de ayudante (€)<input name="helperCost" type="number" min="0" step="0.01" required defaultValue={Number(booking.helperCost || 0).toFixed(2)} /></label></div>
    <label>Lavandería / reparación / mantenimiento real (€)<input name="maintenance" type="number" min="0" step="0.01" required defaultValue={Number(booking.maintenance || 0).toFixed(2)} /></label>
    <label>Notas<textarea name="notes" rows="3" maxLength="1000" defaultValue={booking.notes || ""} placeholder="Lavandería, reparación, incidencia o ajuste manual…" /></label>
    <div className="modal-total"><span>Horario resultante</span><strong>{startTime}–{addMinutesToTime(startTime, durationMinutes)}</strong></div>
    {error && <div className="form-error"><Info size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancelar</button><button className="button button-dark" disabled={busy}>{busy ? "Guardando…" : "Guardar corrección"}<Check size={17} /></button></div>
  </form></section></div>;
}

function StudioProfiles({ bookings }) {
  const studios = useMemo(() => {
    const map = new Map();
    for (const booking of bookings) {
      const key = (booking.studioName || booking.name || "Sin nombre").trim();
      if (!map.has(key)) map.set(key, { name: key, phone: "", contact: "", sessions: [], paid: 0, outstanding: 0 });
      const studio = map.get(key);
      if (booking.phone) studio.phone = booking.phone;
      if (booking.contactName) studio.contact = booking.contactName;
      studio.sessions.push(booking);
      if (booking.status === "completed" && booking.paymentStatus === "paid") studio.paid += Number(booking.gross || 0);
      if (booking.status === "completed" && booking.paymentStatus !== "paid") studio.outstanding += Number(booking.gross || 0);
    }
    return [...map.values()].sort((a, b) => b.sessions.length - a.sessions.length || a.name.localeCompare(b.name, "es"));
  }, [bookings]);
  if (!studios.length) return null;
  return <section className="admin-panel studio-profiles"><div className="panel-title-row"><div><span className="kicker">ESTUDIOS Y FOTÓGRAFOS</span><h2>Clientes profesionales</h2></div><span className="table-counter">{studios.length} contactos</span></div><div className="studio-profile-grid">{studios.map((studio) => <details className="studio-profile-card" key={studio.name}><summary><div><strong>{studio.name}</strong><span>{studio.contact || "Sin persona de contacto"}{studio.phone ? ` · ${studio.phone}` : ""}</span></div><div><strong>{studio.sessions.length}</strong><span>{studio.sessions.length === 1 ? "sesión" : "sesiones"}</span></div></summary><div className="studio-profile-totals"><span>Cobrado <strong>{formatMoney(studio.paid)}</strong></span><span>Pendiente <strong>{formatMoney(studio.outstanding)}</strong></span></div><div className="studio-history">{studio.sessions.slice(0, 8).map((booking) => <div key={booking.id}><span>{formatDate(booking.date)} · {bookingTimeLabel(booking)}</span><strong>{booking.dressName}</strong><small>{typeLabel(booking.sessionType)} · {formatMoney(booking.gross)} · {booking.status === "completed" ? paymentLabel(booking.paymentStatus) : ({ requested: "Solicitud", confirmed: "Confirmada", cancelled: "Cancelada" }[booking.status] || booking.status)}</small></div>)}</div></details>)}</div></section>;
}

function StatusBadge({ status }) {
  const content = { requested: ["Solicitud", Clock3], confirmed: ["Confirmada", CalendarCheck], completed: ["Realizada", CircleCheck], cancelled: ["Cancelada", XCircle] }[status] || [status, Info];
  const [label, Icon] = content;
  return <span className={`status-badge ${status}`}><Icon size={15} />{label}</span>;
}

function AdminBookingModal({ dresses, onClose, onSaved }) {
  const [dressId, setDressId] = useState(dresses[0]?.id || "");
  const [sessionType, setSessionType] = useState("exterior");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [startTime, setStartTime] = useState("10:00");
  const [paymentStatus, setPaymentStatus] = useState("pending");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dress = dresses.find((item) => item.id === dressId);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/admin/bookings", { method: "POST", body: JSON.stringify({
        dressId,
        studioName: form.get("studioName"),
        contactName: form.get("contactName"),
        phone: form.get("phone"),
        date: form.get("date"),
        startTime,
        sessionType,
        durationMinutes,
        paymentStatus,
        notes: form.get("notes"),
      }) });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="form-modal" role="dialog" aria-modal="true" aria-labelledby="rental-modal-title"><button className="close-button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button><span className="kicker"><i /> REGISTRO PRIVADO</span><h2 id="rental-modal-title">Registrar sesión.</h2><p>Registra una sesión ya realizada. Puedes indicar si está cobrada o todavía pendiente.</p>{dresses.length ? <form onSubmit={submit} className="form-stack">
    <label>Vestido<select value={dressId} onChange={(event) => setDressId(event.target.value)}>{dresses.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.color}</option>)}</select></label>
    <label>Estudio fotográfico o fotógrafo<input name="studioName" required minLength="2" maxLength="120" placeholder="Nombre del estudio o profesional" /></label>
    <label>Persona de contacto<input name="contactName" maxLength="100" placeholder="Opcional" /></label>
    <div className="form-columns"><label>Tipo de sesión<select value={sessionType} onChange={(event) => { const next = event.target.value; setSessionType(next); setDurationMinutes(dress ? tariffFor(dress, next).includedMinutes : (next === "interior" ? 30 : 120)); }}><option value="interior">Interior{dress ? ` · ${formatMoney(tariffFor(dress, "interior").price)}` : ""}</option><option value="exterior">Exterior{dress ? ` · ${formatMoney(tariffFor(dress, "exterior").price)}` : ""}</option></select></label><label>Duración<select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{durationOptions(sessionType).map((value) => <option key={value} value={value}>{durationLabel(value)}</option>)}</select></label></div>
    <div className="form-columns"><label>Fecha<input name="date" type="date" max={localDate()} defaultValue={localDate()} required /></label><label>Hora de inicio<select value={startTime} onChange={(event) => setStartTime(event.target.value)}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</select></label></div>
    <div className="form-columns"><label>Teléfono<input name="phone" type="tel" maxLength="40" placeholder="Opcional" /></label><label>Estado del cobro<select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}><option value="pending">Pendiente de cobro</option><option value="paid">Cobrada</option></select></label></div>
    <label>Notas / gastos extraordinarios<textarea name="notes" rows="2" maxLength="1000" placeholder="Ej. reparación de pedrería, incidencia, acuerdo con el estudio…" /></label>
    {dress && <div className="modal-total"><span>Sesión {typeLabel(sessionType)} · {startTime}–{addMinutesToTime(startTime, durationMinutes)} · IVA incluido</span><strong>{formatMoney(priceFor(dress, sessionType, durationMinutes))}</strong></div>}
    {error && <div className="form-error"><Info size={16} />{error}</div>}<button className="button button-dark button-wide" disabled={busy}>{busy ? "Guardando…" : "Registrar sesión realizada"}<Check size={17} /></button>
  </form> : <div className="empty-admin"><Shirt size={28} /><strong>No hay vestidos con tarifas completas.</strong><span>Completa las tarifas del vestido para poder registrar una sesión.</span></div>}</section></div>;
}

function AdminFinance() {
  const [overview, setOverview] = useState(null);
  const [dresses, setDresses] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionType, setSessionType] = useState("exterior");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [selectedDressId, setSelectedDressId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { Promise.all([api("/api/admin/overview"), api("/api/admin/dresses"), api("/api/admin/bookings")]).then(([stats, items, sessions]) => { setOverview(stats); setDresses(items.dresses); setBookings(sessions.bookings); }).catch((caught) => setError(caught.message)).finally(() => setLoading(false)); }, []);
  const settings = overview?.settings || DEFAULT_SETTINGS;
  const pricedDresses = useMemo(() => dresses.filter((dress) => dress.active && isPriced(dress)), [dresses]);
  const first = pricedDresses.find((dress) => dress.id === selectedDressId) || pricedDresses[0];
  const projection = first ? economicsFor(first, sessionType, durationMinutes, settings) : null;
  const baselineMinutes = first ? tariffFor(first, sessionType).includedMinutes : 120;
  const sessionsToRecover = first && projection?.share > 0 ? Math.ceil(first.purchaseCost / economicsFor(first, sessionType, baselineMinutes, settings).share) : 0;
  return <>
    <PageHeading eyebrow="INGRESOS, COSTES Y REPARTO" title="Finanzas con" emphasis="claridad." subtitle="Separa lo realizado de lo cobrado y conserva copias exportables de tus datos." action={<div className="heading-actions"><a className="button button-outline" href="/api/admin/export/bookings.csv">Exportar CSV</a><a className="button button-dark" href="/api/admin/backup.zip">Backup ZIP</a></div>} />
    {error && <div className="inline-error">{error}</div>}
    <div className="finance-stat-grid"><StatCard icon={ReceiptText} label="Ingresos cobrados" value={overview ? formatMoney(overview.grossRevenue) : "—"} detail={overview ? `${overview.paidRentals || 0} sesiones cobradas` : "—"} /><StatCard icon={Clock3} label="Pendiente de cobro" value={overview ? formatMoney(overview.outstandingRevenue) : "—"} detail={overview ? `${overview.outstandingCount || 0} sesiones realizadas` : "—"} /><StatCard icon={Wallet} label="Costes sobre cobros" value={overview ? formatMoney(overview.helperCosts + overview.maintenance) : "—"} detail="Ayudante + mantenimiento real" /><StatCard icon={TrendingUp} label="Beneficio repartible cobrado" value={overview ? formatMoney(overview.distributableProfit) : "—"} detail={`Tu mitad: ${formatMoney(overview?.eachShare || 0)}`} tone="stat-highlight" /></div>
    <InvestmentPortfolio dresses={dresses} bookings={bookings} loading={loading} />
    <div className="finance-columns"><section className="admin-panel finance-calculator"><div className="panel-title-row"><div><span className="kicker">SIMULADOR DE SESIÓN</span><h2>Proyección por vestido</h2></div><span className="tax-pill">IVA incluido</span></div>{first && projection ? <><label className="finance-dress-select">Vestido<select value={first.id} onChange={(event) => setSelectedDressId(event.target.value)}>{pricedDresses.map((dress) => <option key={dress.id} value={dress.id}>{dress.name} · {dress.color}</option>)}</select></label><div className="form-columns"><label>Tipo de sesión<select value={sessionType} onChange={(event) => { const next = event.target.value; setSessionType(next); const selected = pricedDresses.find((item) => item.id === first.id); setDurationMinutes(tariffFor(selected, next).includedMinutes); }}><option value="interior">Interior · {formatMoney(tariffFor(first, "interior").price)} / 30 min</option><option value="exterior">Exterior · {formatMoney(tariffFor(first, "exterior").price)} / hasta 2 h</option></select></label><label>Duración<select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{durationOptions(sessionType).map((value) => <option key={value} value={value}>{durationLabel(value)}</option>)}</select></label></div><div className="finance-breakdown"><FinanceRow label={`Estudio / fotógrafo paga · ${typeLabel(sessionType)}`} value={formatMoney(projection.gross)} strong /><FinanceRow label="IVA incluido (21 %)" value={`− ${formatMoney(projection.vat)}`} muted /><FinanceRow label="Base sin IVA" value={formatMoney(projection.gross - projection.vat)} strong /><FinanceRow label={sessionType === "exterior" ? `Ayudante · ${durationMinutes / 60} h × 20 €` : "Ayudante · no necesario en interior"} value={`− ${formatMoney(projection.helper)}`} muted /><FinanceRow label="Fondo de mantenimiento" value={`− ${formatMoney(projection.maintenance)}`} muted /><FinanceRow label="Beneficio a repartir" value={formatMoney(projection.profit)} strong /></div><div className="share-result"><span><strong>50 %</strong> para cada uno</span><strong>{formatMoney(projection.share)}</strong></div><p className="owner-total">Tu mitad + mantenimiento <strong>{formatMoney(projection.share + projection.maintenance)}</strong></p></> : <div className="empty-admin">Añade un vestido para ver su proyección.</div>}</section>
      <section className="admin-panel recovery-panel"><span className="kicker">RETORNO DE LA INVERSIÓN</span><h2>El vestido se amortiza paso a paso.</h2>{first && projection ? <><div className="recovery-visual"><div className="target-line"><span>Coste inicial · {formatMoney(first.purchaseCost)}</span></div><div className="recovery-bars">{Array.from({ length: Math.min(sessionsToRecover || 1, 8) }, (_, index) => { const sharePerSession = economicsFor(first, sessionType, baselineMinutes, settings).share; const sum = sharePerSession * (index + 1); const reached = sum >= first.purchaseCost; return <div className="recovery-bar-column" key={index}><div className={`recovery-bar ${reached ? "reached" : ""}`} style={{ height: `${Math.min(100, sum / (sharePerSession * (sessionsToRecover || 1)) * 100)}%` }} /><small>{index + 1}</small></div>; })}</div><div className="recovery-axis"><span>1</span><span>{sessionsToRecover} sesiones</span></div></div><div className="recovery-caption"><span>{String(sessionsToRecover).padStart(2, "0")}</span><div><strong>sesiones estimadas para recuperar la compra</strong><small>Inversión de {formatMoney(first.purchaseCost)} · usando {formatMoney(economicsFor(first, sessionType, baselineMinutes, settings).share)} de tu mitad por sesión en {typeLabel(sessionType).toLowerCase()}.</small></div></div></> : <div className="empty-admin">Aún no hay inversiones en la colección.</div>}</section></div>
    <div className="finance-note"><Info size={19} /><div><strong>Cómo se contabiliza ahora</strong><p>Una sesión puede estar realizada pero pendiente de cobro. Solo las sesiones marcadas como cobradas entran en ingresos, beneficio y recuperación. En Editar sesión puedes corregir el importe real, el ayudante y los gastos reales de lavandería, reparación o mantenimiento.</p></div></div>
  </>;
}

function InvestmentPortfolio({ dresses, bookings, loading }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sortBy, setSortBy] = useState("earnings");
  const [visibleCount, setVisibleCount] = useState(6);
  const [compact, setCompact] = useState(false);
  const portfolio = useMemo(() => dresses.map((dress) => {
    const allCompleted = bookings.filter((booking) => booking.dressId === dress.id && booking.status === "completed");
    const completed = allCompleted.filter((booking) => booking.paymentStatus === "paid");
    const outstanding = allCompleted.filter((booking) => booking.paymentStatus !== "paid").reduce((sum, booking) => sum + Number(booking.gross || 0), 0);
    const totals = completed.reduce((sum, booking) => ({
      gross: sum.gross + Number(booking.gross || 0),
      vat: sum.vat + Number(booking.vat || 0),
      helper: sum.helper + Number(booking.helperCost || 0),
      maintenance: sum.maintenance + Number(booking.maintenance || 0),
    }), { gross: 0, vat: 0, helper: 0, maintenance: 0 });
    const investment = Number(dress.purchaseCost || 0);
    const ownerShare = (totals.gross - totals.vat - totals.helper - totals.maintenance) / 2;
    return {
      dress, sessions: allCompleted.length, paidSessions: completed.length, outstanding, ...totals, investment, ownerShare,
      balance: ownerShare - investment,
      remaining: Math.max(0, investment - ownerShare),
      progress: investment > 0 ? Math.min(100, Math.max(0, ownerShare / investment * 100)) : 0,
    };
  }), [dresses, bookings]);
  const invested = portfolio.reduce((sum, item) => sum + item.investment, 0);
  const earned = portfolio.reduce((sum, item) => sum + item.ownerShare, 0);
  const sessions = portfolio.reduce((sum, item) => sum + item.sessions, 0);
  const categories = useMemo(() => [...new Set(portfolio.map((item) => item.dress.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [portfolio]);
  const filteredPortfolio = useMemo(() => {
    const term = query.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
    const result = portfolio.filter((item) => {
      const searchable = `${item.dress.name} ${item.dress.color} ${item.dress.category}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
      return (category === "all" || item.dress.category === category) && searchable.includes(term);
    });
    result.sort((a, b) => {
      if (sortBy === "investment") return b.investment - a.investment || a.dress.name.localeCompare(b.dress.name, "es");
      if (sortBy === "sessions") return b.sessions - a.sessions || a.dress.name.localeCompare(b.dress.name, "es");
      if (sortBy === "name") return a.dress.name.localeCompare(b.dress.name, "es");
      return b.ownerShare - a.ownerShare || a.dress.name.localeCompare(b.dress.name, "es");
    });
    return result;
  }, [portfolio, query, category, sortBy]);
  useEffect(() => setVisibleCount(6), [query, category, sortBy]);
  const visiblePortfolio = compact ? filteredPortfolio : filteredPortfolio.slice(0, visibleCount);

  return <section className={`admin-panel portfolio-section ${compact ? "portfolio-compact-mode" : ""}`} aria-labelledby="portfolio-title">
    <div className="panel-title-row portfolio-heading"><div><span className="kicker">RESULTADOS COBRADOS · POR VESTIDO</span><h2 id="portfolio-title">Tu cartera de vestidos</h2><p>Lo cobrado por cada pieza y cuánto falta para recuperar su compra.</p></div><div className="portfolio-heading-actions"><button type="button" className="portfolio-view-toggle" onClick={() => setCompact((value) => !value)}>{compact ? "Vista detallada" : "Vista compacta"}</button><span className="portfolio-session-count"><CircleCheck size={16} /> {sessions} {sessions === 1 ? "sesión realizada" : "sesiones realizadas"}</span></div></div>
    {loading ? <div className="loading-card">Cargando tu cartera…</div> : portfolio.length ? <>
      <div className="portfolio-summary"><div><span>Inversión total</span><strong>{formatMoney(invested, 2)}</strong></div><div><span>Tu beneficio acumulado</span><strong>{formatMoney(earned, 2)}</strong></div><div><span>Resultado tras la compra</span><strong className={earned - invested >= 0 ? "positive" : "negative"}>{formatMoney(earned - invested, 2)}</strong></div></div>
      {portfolio.length > 6 && <div className="portfolio-toolbar"><label className="portfolio-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Buscar vestido</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar vestido, color o categoría" /></label><label className="portfolio-select"><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Todas</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="portfolio-select"><span>Ordenar por</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="earnings">Mayor beneficio</option><option value="sessions">Más sesiones</option><option value="investment">Mayor inversión</option><option value="name">Nombre</option></select></label></div>}
      {filteredPortfolio.length ? <div className="portfolio-grid">{visiblePortfolio.map((item) => <article className="portfolio-card" key={item.dress.id}>
        <div className="portfolio-card-top"><img src={item.dress.images?.[0] || FALLBACK_IMAGE} alt={item.dress.name} /><div><span className="portfolio-category">{item.dress.category}{!item.dress.active ? " · Archivado" : ""}</span><h3>{item.dress.name}</h3><p>{item.paidSessions} cobradas · {item.sessions - item.paidSessions} pendientes</p></div><span className={`portfolio-status ${item.remaining === 0 && item.investment > 0 ? "recovered" : ""}`}>{item.investment > 0 && item.remaining === 0 ? "Recuperado" : item.sessions ? "En recuperación" : "Por empezar"}</span></div>
        <div className="portfolio-card-metrics"><div><span>Coste de compra</span><strong>{formatMoney(item.investment, 2)}</strong></div><div><span>Tu beneficio acumulado</span><strong>{formatMoney(item.ownerShare, 2)}</strong></div><div><span>{item.remaining > 0 ? "Pendiente de recuperar" : "Ganancia tras compra"}</span><strong className={item.remaining > 0 ? "" : "positive"}>{formatMoney(item.remaining > 0 ? item.remaining : item.balance, 2)}</strong></div></div>
        <div className="portfolio-progress-label"><span>{item.investment > 0 ? `${item.progress.toLocaleString("es-ES", { maximumFractionDigits: 1 })} % de la compra recuperada` : "Sin coste de compra registrado"}</span><strong>{item.investment > 0 ? `${Math.min(100, Math.round(item.progress))} %` : "—"}</strong></div><div className="portfolio-progress" role="progressbar" aria-label={`Compra recuperada de ${item.dress.name}`} aria-valuenow={Math.round(item.progress)} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${item.progress}%` }} /></div>
        <div className="portfolio-ledger"><div><span>Cobrado con IVA</span><strong>{formatMoney(item.gross, 2)}</strong></div><div><span>Pendiente de cobro</span><strong>{formatMoney(item.outstanding, 2)}</strong></div><div><span>IVA</span><strong>− {formatMoney(item.vat, 2)}</strong></div><div><span>Ayudante</span><strong>− {formatMoney(item.helper, 2)}</strong></div><div><span>Fondo de mantenimiento</span><strong>− {formatMoney(item.maintenance, 2)}</strong></div><div><span>Mitad de tu esposa</span><strong>− {formatMoney(item.ownerShare, 2)}</strong></div></div>
      </article>)}</div> : <div className="portfolio-empty"><Search size={25} /><strong>No hay vestidos con esos filtros.</strong><button type="button" onClick={() => { setQuery(""); setCategory("all"); }}>Ver toda la cartera</button></div>}
      {!compact && filteredPortfolio.length > 6 && <div className="portfolio-pagination"><span>Mostrando {visiblePortfolio.length} de {filteredPortfolio.length} vestidos</span><div>{visibleCount > 6 && <button type="button" onClick={() => setVisibleCount(6)}>Ver menos</button>}{visibleCount < filteredPortfolio.length && <button type="button" className="portfolio-more" onClick={() => setVisibleCount((count) => count + 6)}>Mostrar {Math.min(6, filteredPortfolio.length - visibleCount)} más <ArrowRight size={16} /></button>}</div></div>}
      <p className="portfolio-note"><Info size={16} /> La recuperación utiliza solo tu mitad del beneficio de sesiones realizadas y cobradas. Las sesiones pendientes de cobro se muestran aparte y todavía no amortizan la compra.</p>
    </> : <div className="empty-admin"><Shirt size={28} /><strong>Todavía no hay vestidos en la cartera.</strong><span>Añade el primero desde Vestidos para seguir su rendimiento.</span></div>}
  </section>;
}

function FinanceRow({ label, value, strong = false, muted = false }) {
  return <div className={`finance-row ${strong ? "strong" : ""} ${muted ? "muted" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

export default App;
