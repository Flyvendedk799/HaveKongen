import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Send, X, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "watering.gardenChat.msgs";

export default function GardenChatBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const userMsg: Msg = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/garden-chat`;
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      });
      if (!resp.ok) {
        if (resp.status === 429) { toast.error("AI er optaget — prøv igen om lidt"); return; }
        if (resp.status === 402) { toast.error("AI-kredit opbrugt"); return; }
        toast.error("AI-fejl");
        return;
      }
      if (!resp.body) { toast.error("Tomt svar"); return; }

      let acc = "";
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") { done = true; break; }
          try {
            const j = JSON.parse(data);
            const c = j?.choices?.[0]?.delta?.content;
            if (c) {
              acc += c;
              setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: acc } : m));
            }
          } catch { /* ignore partial */ }
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Fejl");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <motion.button
        onClick={() => setOpen(o => !o)}
        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
        style={{
          position: "fixed", bottom: 88, right: 20, zIndex: 50,
          width: 56, height: 56, borderRadius: 28, border: "none", cursor: "pointer",
          background: "linear-gradient(135deg, #3aa67a, #2563a8)", color: "white",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 8px 24px rgba(20,39,29,0.25)",
        }}
        aria-label="Have-chat"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            style={{
              position: "fixed", bottom: 156, right: 20, zIndex: 50,
              width: "min(380px, calc(100vw - 32px))", height: "min(560px, calc(100vh - 200px))",
              background: "var(--paper)", borderRadius: 18, boxShadow: "0 16px 48px rgba(20,39,29,0.22)",
              display: "flex", flexDirection: "column", overflow: "hidden",
              border: "1px solid rgba(20,39,29,0.06)",
            }}
          >
            <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(20,39,29,0.06)", display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={16} style={{ color: "var(--forest-800)" }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Have-coach</div>
                <div style={{ fontSize: 11, color: "var(--ink-500)" }}>Spørg om planter, opgaver, vanding…</div>
              </div>
            </div>

            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.length === 0 && (
                <div style={{ color: "var(--ink-500)", fontSize: 13, textAlign: "center", padding: 24 }}>
                  Hej! Spørg fx <em>"hvornår skal jeg så gulerødder?"</em> eller <em>"opret en opgave: beskær roser om 3 dage"</em>.
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "9px 13px", borderRadius: 14,
                  background: m.role === "user" ? "var(--forest-800)" : "var(--ink-50)",
                  color: m.role === "user" ? "white" : "var(--ink-900)",
                  fontSize: 13.5, lineHeight: 1.5,
                }}>
                  {m.role === "assistant"
                    ? <div className="prose prose-sm" style={{ maxWidth: "none" }}><ReactMarkdown>{m.content || "…"}</ReactMarkdown></div>
                    : m.content}
                </div>
              ))}
            </div>

            <div style={{ padding: 12, borderTop: "1px solid rgba(20,39,29,0.06)", display: "flex", gap: 8, alignItems: "flex-end" }}>
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Skriv en besked…"
                rows={1}
                style={{ minHeight: 40, maxHeight: 100, resize: "none", fontSize: 13 }}
                disabled={sending}
              />
              <Button onClick={send} disabled={sending || !input.trim()} size="sm" style={{ height: 40 }}>
                <Send size={14} />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
