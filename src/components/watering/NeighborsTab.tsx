import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Heart, MessageCircle, Send, Sprout, Lightbulb, HelpCircle, Trophy, Repeat, MapPin, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { uploadPlantPhoto } from "@/lib/plantPhotos";
import { toast } from "sonner";

type Post = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  image_url: string | null;
  postal_code: string | null;
  created_at: string;
  data: any;
};

type Comment = { id: string; post_id: string; user_id: string; body: string; created_at: string };
type Like = { post_id: string; user_id: string };
type Swap = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  qty: string | null;
  wants: string | null;
  status: string;
  image_url: string | null;
  plant_slug: string | null;
  created_at: string;
};
type Profile = { id: string; name: string | null; avatar_url: string | null; postal_code: string | null };

const KIND_META: Record<string, { label: string; icon: any; color: string }> = {
  tip: { label: "Tip", icon: Lightbulb, color: "#ca8a04" },
  question: { label: "Spørgsmål", icon: HelpCircle, color: "#2563eb" },
  harvest: { label: "Høst", icon: Trophy, color: "#16a34a" },
  swap: { label: "Bytte", icon: Repeat, color: "#9333ea" },
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "lige nu";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} t`;
  const d = Math.floor(h / 24);
  return `${d} d`;
}

export default function NeighborsTab() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"feed" | "swaps">("feed");
  const [postalCode, setPostalCode] = useState<string | null>(null);
  const [postalDraft, setPostalDraft] = useState("");
  const [savingPostal, setSavingPostal] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [likes, setLikes] = useState<Like[]>([]);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);

  // composer
  const [composerOpen, setComposerOpen] = useState(false);
  const [pKind, setPKind] = useState("tip");
  const [pTitle, setPTitle] = useState("");
  const [pBody, setPBody] = useState("");
  const [pImage, setPImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);

  // swap composer
  const [swapOpen, setSwapOpen] = useState(false);
  const [sTitle, setSTitle] = useState("");
  const [sQty, setSQty] = useState("");
  const [sWants, setSWants] = useState("");
  const [sDesc, setSDesc] = useState("");
  const [sImage, setSImage] = useState<string | null>(null);
  const [sPosting, setSPosting] = useState(false);

  // expanded comments per post
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [draftComment, setDraftComment] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    void loadPostal();
  }, [user]);

  useEffect(() => {
    if (!user || !postalCode) return;
    void load();
  }, [user, postalCode]);

  async function loadPostal() {
    const { data } = await supabase.from("profiles").select("postal_code").eq("id", user!.id).maybeSingle();
    setPostalCode(data?.postal_code ?? null);
  }

  async function savePostal() {
    if (!postalDraft.trim()) return;
    setSavingPostal(true);
    const { error } = await supabase.from("profiles").update({ postal_code: postalDraft.trim() }).eq("id", user!.id);
    setSavingPostal(false);
    if (error) { toast.error("Kunne ikke gemme postnummer"); return; }
    setPostalCode(postalDraft.trim());
    toast.success("Postnummer gemt — velkommen til naboerne 🌱");
  }

  async function load() {
    setLoading(true);
    const [postsRes, swapsRes] = await Promise.all([
      supabase.from("neighbor_posts").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("seed_swaps").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    const ps: Post[] = (postsRes.data ?? []) as any;
    const sws: Swap[] = (swapsRes.data ?? []) as any;
    setPosts(ps);
    setSwaps(sws);

    const userIds = Array.from(new Set([...ps.map((p) => p.user_id), ...sws.map((s) => s.user_id)]));
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id,name,avatar_url,postal_code").in("id", userIds);
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p: any) => { map[p.id] = p; });
      setProfiles(map);
    }
    if (ps.length) {
      const ids = ps.map((p) => p.id);
      const [cRes, lRes] = await Promise.all([
        supabase.from("neighbor_comments").select("*").in("post_id", ids).order("created_at", { ascending: true }),
        supabase.from("neighbor_likes").select("*").in("post_id", ids),
      ]);
      const cmap: Record<string, Comment[]> = {};
      (cRes.data ?? []).forEach((c: any) => { (cmap[c.post_id] ??= []).push(c); });
      setComments(cmap);
      setLikes((lRes.data ?? []) as any);
    }
    setLoading(false);
  }

  async function onPickImage(file: File, setter: (v: string | null) => void) {
    setUploading(true);
    try {
      const url = await uploadPlantPhoto(user!.id, file);
      setter(url);
    } catch { toast.error("Upload fejlede"); }
    setUploading(false);
  }

  async function publishPost() {
    if (!pTitle.trim()) return;
    setPosting(true);
    const { error } = await supabase.from("neighbor_posts").insert({
      user_id: user!.id, kind: pKind, title: pTitle.trim(), body: pBody || null,
      image_url: pImage, postal_code: postalCode,
    });
    setPosting(false);
    if (error) { toast.error("Kunne ikke poste"); return; }
    setPTitle(""); setPBody(""); setPImage(null); setComposerOpen(false);
    toast.success("Delt med dine naboer 🌿");
    void load();
  }

  async function publishSwap() {
    if (!sTitle.trim()) return;
    setSPosting(true);
    const { error } = await supabase.from("seed_swaps").insert({
      user_id: user!.id, title: sTitle.trim(), description: sDesc || null,
      qty: sQty || null, wants: sWants || null, image_url: sImage, postal_code: postalCode,
    });
    setSPosting(false);
    if (error) { toast.error("Kunne ikke oprette bytte"); return; }
    setSTitle(""); setSDesc(""); setSQty(""); setSWants(""); setSImage(null); setSwapOpen(false);
    toast.success("Bytte oprettet 🌱");
    void load();
  }

  async function toggleLike(postId: string) {
    const liked = likes.some((l) => l.post_id === postId && l.user_id === user!.id);
    if (liked) {
      await supabase.from("neighbor_likes").delete().match({ post_id: postId, user_id: user!.id });
      setLikes((ls) => ls.filter((l) => !(l.post_id === postId && l.user_id === user!.id)));
    } else {
      await supabase.from("neighbor_likes").insert({ post_id: postId, user_id: user!.id });
      setLikes((ls) => [...ls, { post_id: postId, user_id: user!.id }]);
    }
  }

  async function postComment(postId: string) {
    const body = (draftComment[postId] ?? "").trim();
    if (!body) return;
    const { data, error } = await supabase.from("neighbor_comments").insert({
      post_id: postId, user_id: user!.id, body,
    }).select().single();
    if (error || !data) { toast.error("Kunne ikke kommentere"); return; }
    setComments((c) => ({ ...c, [postId]: [...(c[postId] ?? []), data as any] }));
    setDraftComment((d) => ({ ...d, [postId]: "" }));
  }

  async function deletePost(p: Post) {
    if (!confirm("Slet opslag?")) return;
    await supabase.from("neighbor_posts").delete().eq("id", p.id);
    setPosts((ps) => ps.filter((x) => x.id !== p.id));
  }

  async function deleteSwap(s: Swap) {
    if (!confirm("Slet bytte?")) return;
    await supabase.from("seed_swaps").delete().eq("id", s.id);
    setSwaps((xs) => xs.filter((x) => x.id !== s.id));
  }

  const likesByPost = useMemo(() => {
    const m: Record<string, number> = {};
    likes.forEach((l) => { m[l.post_id] = (m[l.post_id] ?? 0) + 1; });
    return m;
  }, [likes]);

  if (!user) return null;

  if (!postalCode) {
    return (
      <div className="water-card" style={{ maxWidth: 480 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <MapPin size={18} /> <h3 style={{ margin: 0 }}>Tilføj dit postnummer</h3>
        </div>
        <p style={{ color: "var(--ink-500)", fontSize: 14, marginBottom: 14 }}>
          For at se og dele med naboer i dit lokalområde, har vi brug for dit postnummer. Det vises ikke for andre.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Input placeholder="fx 8000" value={postalDraft} onChange={(e) => setPostalDraft(e.target.value)} maxLength={10} />
          <Button onClick={savePostal} disabled={savingPostal || !postalDraft.trim()}>
            {savingPostal ? <Loader2 className="animate-spin" size={14} /> : "Gem"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>Naboer</h2>
          <div style={{ color: "var(--ink-500)", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <MapPin size={12} /> {postalCode}
          </div>
        </div>
        <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--ink-50)", borderRadius: 100 }}>
          {(["feed", "swaps"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: "6px 14px", borderRadius: 100, border: "none",
                background: tab === t ? "var(--paper)" : "transparent",
                color: tab === t ? "var(--ink-900)" : "var(--ink-500)",
                fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}>
              {t === "feed" ? "Feed" : "Frø-bytte"}
            </button>
          ))}
        </div>
      </div>

      {tab === "feed" && (
        <>
          {/* Composer trigger */}
          {!composerOpen ? (
            <button onClick={() => setComposerOpen(true)}
              className="water-card"
              style={{ textAlign: "left", cursor: "pointer", color: "var(--ink-500)", border: "1px dashed var(--ink-200)" }}>
              <Sprout size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
              Del et tip, billede eller spørgsmål med dine naboer…
            </button>
          ) : (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="water-card">
              <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                {Object.entries(KIND_META).filter(([k]) => k !== "swap").map(([k, m]) => {
                  const Icon = m.icon;
                  const active = pKind === k;
                  return (
                    <button key={k} onClick={() => setPKind(k)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px",
                        borderRadius: 100, border: `1px solid ${active ? m.color : "var(--ink-200)"}`,
                        background: active ? `${m.color}15` : "transparent",
                        color: active ? m.color : "var(--ink-700)", fontSize: 13, cursor: "pointer",
                      }}>
                      <Icon size={13} /> {m.label}
                    </button>
                  );
                })}
              </div>
              <Input placeholder="Titel" value={pTitle} onChange={(e) => setPTitle(e.target.value)} style={{ marginBottom: 8 }} />
              <Textarea placeholder="Skriv noget…" value={pBody} onChange={(e) => setPBody(e.target.value)} rows={3} style={{ marginBottom: 8 }} />
              {pImage && <img src={pImage} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", border: "1px solid var(--ink-200)", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  {pImage ? "Skift billede" : "Tilføj billede"}
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickImage(f, setPImage); }} />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="ghost" onClick={() => { setComposerOpen(false); setPTitle(""); setPBody(""); setPImage(null); }}>Annuller</Button>
                  <Button onClick={publishPost} disabled={posting || !pTitle.trim()}>
                    {posting ? <Loader2 size={14} className="animate-spin" /> : <><Send size={14} className="mr-1" />Del</>}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {loading ? (
            <div style={{ color: "var(--ink-500)" }}>Indlæser…</div>
          ) : posts.length === 0 ? (
            <div className="water-card" style={{ textAlign: "center", color: "var(--ink-500)" }}>
              Ingen opslag endnu i {postalCode}. Vær den første til at dele 🌱
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <AnimatePresence initial={false}>
                {posts.map((p) => {
                  const meta = KIND_META[p.kind] ?? KIND_META.tip;
                  const Icon = meta.icon;
                  const author = profiles[p.user_id];
                  const liked = likes.some((l) => l.post_id === p.id && l.user_id === user.id);
                  const cs = comments[p.id] ?? [];
                  const open = openComments[p.id];
                  const isOwn = p.user_id === user.id;
                  return (
                    <motion.div key={p.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="water-card">
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--ink-100)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "var(--ink-500)" }}>
                          {author?.avatar_url ? <img src={author.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (author?.name ?? "N").slice(0, 1).toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{author?.name ?? "Nabo"}</div>
                          <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{timeAgo(p.created_at)} · {p.postal_code ?? postalCode}</div>
                        </div>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "3px 8px", borderRadius: 100, background: `${meta.color}15`, color: meta.color }}>
                          <Icon size={11} /> {meta.label}
                        </span>
                        {isOwn && (
                          <Button size="sm" variant="ghost" onClick={() => deletePost(p)}><Trash2 size={13} /></Button>
                        )}
                      </div>
                      <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{p.title}</h3>
                      {p.body && <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--ink-700)", whiteSpace: "pre-wrap" }}>{p.body}</p>}
                      {p.image_url && <img src={p.image_url} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}
                      <div style={{ display: "flex", gap: 6, marginTop: 6, borderTop: "1px solid var(--ink-100)", paddingTop: 8 }}>
                        <Button size="sm" variant="ghost" onClick={() => toggleLike(p.id)}>
                          <Heart size={14} className="mr-1" fill={liked ? "#dc2626" : "none"} color={liked ? "#dc2626" : "currentColor"} />
                          {likesByPost[p.id] ?? 0}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setOpenComments((o) => ({ ...o, [p.id]: !o[p.id] }))}>
                          <MessageCircle size={14} className="mr-1" /> {cs.length}
                        </Button>
                      </div>
                      {open && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--ink-100)", display: "grid", gap: 8 }}>
                          {cs.map((c) => {
                            const a = profiles[c.user_id];
                            return (
                              <div key={c.id} style={{ display: "flex", gap: 8 }}>
                                <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--ink-100)", flexShrink: 0, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>
                                  {(a?.name ?? "N").slice(0, 1).toUpperCase()}
                                </div>
                                <div style={{ background: "var(--ink-50)", padding: "6px 10px", borderRadius: 12, fontSize: 13 }}>
                                  <div style={{ fontWeight: 600, fontSize: 11 }}>{a?.name ?? "Nabo"}</div>
                                  {c.body}
                                </div>
                              </div>
                            );
                          })}
                          <div style={{ display: "flex", gap: 6 }}>
                            <Input placeholder="Skriv en kommentar…" value={draftComment[p.id] ?? ""}
                              onChange={(e) => setDraftComment((d) => ({ ...d, [p.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") postComment(p.id); }} />
                            <Button size="sm" onClick={() => postComment(p.id)}><Send size={13} /></Button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      {tab === "swaps" && (
        <>
          {!swapOpen ? (
            <button onClick={() => setSwapOpen(true)}
              className="water-card"
              style={{ textAlign: "left", cursor: "pointer", color: "var(--ink-500)", border: "1px dashed var(--ink-200)" }}>
              <Repeat size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
              Tilbyd frø, stiklinger eller planter til en nabo…
            </button>
          ) : (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="water-card">
              <Input placeholder="Hvad tilbyder du? (fx Tomatfrø 'San Marzano')" value={sTitle} onChange={(e) => setSTitle(e.target.value)} style={{ marginBottom: 8 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <Input placeholder="Mængde (fx 20 frø)" value={sQty} onChange={(e) => setSQty(e.target.value)} />
                <Input placeholder="Bytter mod… (eller gratis)" value={sWants} onChange={(e) => setSWants(e.target.value)} />
              </div>
              <Textarea placeholder="Beskrivelse" value={sDesc} onChange={(e) => setSDesc(e.target.value)} rows={2} style={{ marginBottom: 8 }} />
              {sImage && <img src={sImage} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", border: "1px solid var(--ink-200)", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  {sImage ? "Skift billede" : "Billede"}
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickImage(f, setSImage); }} />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="ghost" onClick={() => { setSwapOpen(false); setSTitle(""); setSDesc(""); setSQty(""); setSWants(""); setSImage(null); }}>Annuller</Button>
                  <Button onClick={publishSwap} disabled={sPosting || !sTitle.trim()}>
                    {sPosting ? <Loader2 size={14} className="animate-spin" /> : "Opret bytte"}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {loading ? (
            <div style={{ color: "var(--ink-500)" }}>Indlæser…</div>
          ) : swaps.length === 0 ? (
            <div className="water-card" style={{ textAlign: "center", color: "var(--ink-500)" }}>
              Ingen bytte-tilbud i dit område endnu.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
              {swaps.map((s) => {
                const author = profiles[s.user_id];
                const isOwn = s.user_id === user.id;
                return (
                  <motion.div key={s.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="water-card">
                    {s.image_url && <img src={s.image_url} alt="" style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <h3 style={{ margin: 0, fontSize: 15 }}>{s.title}</h3>
                      {isOwn && <Button size="sm" variant="ghost" onClick={() => deleteSwap(s)}><Trash2 size={12} /></Button>}
                    </div>
                    {s.qty && <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>Mængde: {s.qty}</div>}
                    {s.wants && <div style={{ fontSize: 12, color: "var(--ink-500)" }}>Bytter mod: {s.wants}</div>}
                    {s.description && <p style={{ fontSize: 13, color: "var(--ink-700)", margin: "8px 0 0" }}>{s.description}</p>}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 11, color: "var(--ink-500)", borderTop: "1px solid var(--ink-100)", paddingTop: 8 }}>
                      <div style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--ink-100)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 600 }}>
                        {(author?.name ?? "N").slice(0, 1).toUpperCase()}
                      </div>
                      {author?.name ?? "Nabo"} · {timeAgo(s.created_at)}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
