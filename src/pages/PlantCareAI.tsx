import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Msg = { role: "user" | "assistant"; content: string | ContentPart[] };
type Conv = { id: string; title: string; updated_at: string };

const STARTERS = [
  "Hvornår skal jeg beskære mine æbletræer?",
  "Min græsplæne har gule pletter — hvad gør jeg?",
  "Hvad kan jeg så i april i Danmark?",
  "Hvilken gødning til mine roser?",
];

export default function PlantCareAI() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast.error("Billede er for stort (max 8 MB)."); return; }
    const reader = new FileReader();
    reader.onload = () => setPendingImage(reader.result as string);
    reader.readAsDataURL(f);
    e.target.value = "";
  }

  useEffect(() => {
    if (user) loadConversations();
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  async function loadConversations() {
    const { data } = await supabase
      .from("chat_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    setConversations(data ?? []);
  }

  async function loadMessages(convId: string) {
    setActiveConv(convId);
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .order("created_at");
    setMessages((data ?? []) as Msg[]);
  }

  function newConversation() {
    setActiveConv(null);
    setMessages([]);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && !pendingImage) || streaming || !user) return;
    setInput("");
    const imageDataUrl = pendingImage;
    setPendingImage(null);

    const content: string | ContentPart[] = imageDataUrl
      ? [
          { type: "text", text: trimmed || "Hvad er der galt med denne plante?" },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ]
      : trimmed;

    const userMsg: Msg = { role: "user", content };
    const history = [...messages, userMsg];
    setMessages(history);
    setStreaming(true);

    let convId = activeConv;
    try {
      // Create conversation if none
      if (!convId) {
        const title = (trimmed || "Billed-diagnose").slice(0, 60);
        const { data, error } = await supabase
          .from("chat_conversations")
          .insert({ user_id: user.id, title })
          .select("id")
          .single();
        if (error) throw error;
        convId = data.id;
        setActiveConv(convId);
      }

      // Persist user message (text-only summary; we don't store image in DB)
      const persistedText = imageDataUrl
        ? `[📷 Billede vedhæftet] ${trimmed}`.trim()
        : trimmed;
      await supabase.from("chat_messages").insert({
        conversation_id: convId,
        user_id: user.id,
        role: "user",
        content: persistedText,
      });

      // Call edge function with streaming
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/plant-care-chat`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: history, hasImage: !!imageDataUrl }),
      });

      if (resp.status === 429) { toast.error("For mange beskeder — prøv igen om lidt."); setStreaming(false); return; }
      if (resp.status === 402) { toast.error("AI-kreditter opbrugt."); setStreaming(false); return; }
      if (!resp.ok || !resp.body) { toast.error("AI-tjenesten svarer ikke."); setStreaming(false); return; }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let done = false;

      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantText += delta;
              setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantText } : m));
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Persist assistant
      if (assistantText) {
        await supabase.from("chat_messages").insert({
          conversation_id: convId,
          user_id: user.id,
          role: "assistant",
          content: assistantText,
        });
        await supabase
          .from("chat_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", convId);
        loadConversations();
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? "Noget gik galt.");
    } finally {
      setStreaming(false);
    }
  }

  async function deleteConv(id: string) {
    await supabase.from("chat_messages").delete().eq("conversation_id", id);
    await supabase.from("chat_conversations").delete().eq("id", id);
    if (activeConv === id) { setActiveConv(null); setMessages([]); }
    loadConversations();
  }

  if (authLoading) return null;

  if (!user) {
    return (
      <>
        <AppNav active="ai" />
        <div className="container">
          <header className="page-head">
            <div className="eyebrow" style={{ marginBottom: 14 }}>Plantepleje AI</div>
            <h1>Log ind for at spørge</h1>
            <p className="lede">Din samtalehistorik gemmes så du altid kan vende tilbage.</p>
          </header>
          <div style={{ padding: "20px 0 80px" }}>
            <Link to="/login" className="btn btn-primary">Log ind</Link>
          </div>
        </div>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <AppNav active="ai" />
      <div className="container" style={{ paddingBottom: 40 }}>
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Plantepleje AI</div>
          <h1>Spørg om alt. Den kender din have.</h1>
          <p className="lede">Beskæring, gødning, sygdomme, sæsonpleje — på dansk, med konkrete svar.</p>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 24, alignItems: "start" }}>
          {/* Sidebar */}
          <aside style={{
            background: "var(--paper)",
            border: "1px solid var(--ink-100)",
            borderRadius: 16,
            padding: 16,
            position: "sticky",
            top: 24,
            maxHeight: "calc(100vh - 48px)",
            overflowY: "auto",
          }}>
            <button onClick={newConversation} className="btn btn-primary btn-sm" style={{ width: "100%", marginBottom: 16 }}>
              + Ny samtale
            </button>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-500)", marginBottom: 8 }}>
              Historik
            </div>
            {conversations.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--ink-500)" }}>Ingen samtaler endnu.</div>
            )}
            {conversations.map(c => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  padding: "8px 10px",
                  borderRadius: 10,
                  cursor: "pointer",
                  background: activeConv === c.id ? "var(--ink-50)" : "transparent",
                  marginBottom: 2,
                }}
                onClick={() => loadMessages(c.id)}
              >
                <div style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.title}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConv(c.id); }}
                  style={{ background: "none", border: "none", color: "var(--ink-500)", cursor: "pointer", fontSize: 14, padding: 2 }}
                  aria-label="Slet"
                >×</button>
              </div>
            ))}
          </aside>

          {/* Chat */}
          <section style={{
            background: "var(--paper)",
            border: "1px solid var(--ink-100)",
            borderRadius: 20,
            display: "flex",
            flexDirection: "column",
            minHeight: 600,
            maxHeight: "calc(100vh - 48px)",
          }}>
            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
              {messages.length === 0 ? (
                <div>
                  <h3 style={{ marginTop: 0, fontSize: 22 }}>Hvad kan jeg hjælpe med?</h3>
                  <p style={{ color: "var(--ink-500)", marginBottom: 24 }}>Prøv et af disse — eller stil dit eget spørgsmål.</p>
                  <div style={{ display: "grid", gap: 10 }}>
                    {STARTERS.map(s => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        style={{
                          textAlign: "left",
                          padding: "14px 18px",
                          background: "var(--ink-50)",
                          border: "1px solid var(--ink-100)",
                          borderRadius: 12,
                          cursor: "pointer",
                          fontSize: 14,
                          color: "var(--ink-900)",
                        }}
                      >{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => {
                  const text = typeof m.content === "string"
                    ? m.content
                    : (m.content.find((p) => p.type === "text") as any)?.text ?? "";
                  const img = typeof m.content === "string"
                    ? null
                    : (m.content.find((p) => p.type === "image_url") as any)?.image_url?.url;
                  const isLastAssistant = m.role === "assistant" && i === messages.length - 1 && !streaming && text;
                  return (
                    <div key={i} style={{ marginBottom: 22, display: "flex", gap: 12 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 16, flexShrink: 0,
                        background: m.role === "user" ? "var(--forest-800)" : "var(--ochre-600)",
                        color: "white",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 600,
                      }}>
                        {m.role === "user" ? "Du" : "🌿"}
                      </div>
                      <div style={{ flex: 1, paddingTop: 4 }}>
                        {img && (
                          <img src={img} alt="vedhæftet" style={{ maxWidth: 240, borderRadius: 10, marginBottom: 10, display: "block" }} />
                        )}
                        <div className="prose-chat" style={{ fontSize: 15, lineHeight: 1.65, color: "var(--ink-900)" }}>
                          {m.role === "assistant" ? (
                            <ReactMarkdown>{text || "…"}</ReactMarkdown>
                          ) : (
                            <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>
                          )}
                        </div>
                        {isLastAssistant && (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/vanding")}>💧 Lav vandingsplan</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/webshop")}>🛒 Find i shop</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/havemaaler")}>📐 Mål have</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {pendingImage && (
              <div style={{ borderTop: "1px solid var(--ink-100)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <img src={pendingImage} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8 }} />
                <span style={{ fontSize: 13, color: "var(--ink-500)", flex: 1 }}>Billede klar — beskriv evt. symptomerne</span>
                <button onClick={() => setPendingImage(null)} className="btn btn-ghost btn-sm">Fjern</button>
              </div>
            )}

            <form
              onSubmit={(e) => { e.preventDefault(); send(input); }}
              style={{ borderTop: "1px solid var(--ink-100)", padding: 16, display: "flex", gap: 10, alignItems: "center" }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onPickImage}
                style={{ display: "none" }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-ghost"
                disabled={streaming}
                aria-label="Vedhæft billede"
                style={{ padding: "10px 14px" }}
              >📷</button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={pendingImage ? "Beskriv hvad du ser…" : "Spørg om beskæring, sygdomme, gødning…"}
                disabled={streaming}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  border: "1px solid var(--ink-100)",
                  borderRadius: 12,
                  fontSize: 15,
                  background: "var(--ink-50)",
                  outline: "none",
                }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={streaming || (!input.trim() && !pendingImage)}
              >
                {streaming ? "…" : "Send"}
              </button>
            </form>
          </section>
        </div>
      </div>

      <style>{`
        .prose-chat p { margin: 0 0 10px; }
        .prose-chat ul, .prose-chat ol { margin: 8px 0 12px; padding-left: 22px; }
        .prose-chat li { margin: 4px 0; }
        .prose-chat strong { color: var(--forest-800); }
        .prose-chat h1, .prose-chat h2, .prose-chat h3 { margin: 16px 0 8px; }
        .prose-chat code { background: var(--ink-50); padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
      `}</style>

      <SiteFooter />
    </>
  );
}
