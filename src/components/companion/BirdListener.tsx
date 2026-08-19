import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Bird, Ear, Feather, Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  bytesToBase64,
  concatChunks,
  confidenceLabel,
  downsampleBuffer,
  encodeWavPcm16,
  planLifeListUpserts,
  type BirdDetection,
  type LifeListRow,
} from "@/lib/birdListener";

const LISTEN_SECONDS = 60;
const TARGET_SAMPLE_RATE = 16000;
const MIN_SECONDS = 3;

type Phase = "idle" | "recording" | "analyzing";

type Props = {
  userId: string;
  gardenId: string | null;
};

type Recorder = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  startedAt: number;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" });
}

export default function BirdListener({ userId, gardenId }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [secondsLeft, setSecondsLeft] = useState(LISTEN_SECONDS);
  const [detections, setDetections] = useState<BirdDetection[] | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [newKeys, setNewKeys] = useState<string[]>([]);
  const [lifeList, setLifeList] = useState<LifeListRow[]>([]);
  const recorderRef = useRef<Recorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);

  const loadLifeList = useCallback(async () => {
    const { data } = await supabase
      .from("animal_life_list")
      .select("id,species_key,name_da,latin,kind,confidence,observation_count,first_observed_at,last_observed_at")
      .eq("user_id", userId)
      .order("last_observed_at", { ascending: false });
    setLifeList((data ?? []) as LifeListRow[]);
  }, [userId]);

  useEffect(() => {
    void loadLifeList();
  }, [loadLifeList]);

  const teardownRecorder = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return null;
    try {
      recorder.processor.disconnect();
      recorder.source.disconnect();
      recorder.stream.getTracks().forEach((track) => track.stop());
      void recorder.context.close();
    } catch {
      // best effort cleanup
    }
    return recorder;
  }, []);

  useEffect(() => () => {
    teardownRecorder();
  }, [teardownRecorder]);

  const stopAndAnalyze = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const recorder = teardownRecorder();
    if (!recorder) {
      stoppingRef.current = false;
      setPhase("idle");
      return;
    }

    const elapsedSeconds = (Date.now() - recorder.startedAt) / 1000;
    if (elapsedSeconds < MIN_SECONDS) {
      stoppingRef.current = false;
      setPhase("idle");
      setSecondsLeft(LISTEN_SECONDS);
      toast.error(`Optag mindst ${MIN_SECONDS} sekunder, før AI kan lytte efter fugle`);
      return;
    }

    setPhase("analyzing");
    try {
      const samples = concatChunks(recorder.chunks);
      const mono = downsampleBuffer(samples, recorder.context.sampleRate || 48000, TARGET_SAMPLE_RATE);
      const wav = encodeWavPcm16(mono, Math.min(recorder.context.sampleRate || 48000, TARGET_SAMPLE_RATE));
      const res = await supabase.functions.invoke("identify-bird-audio", {
        body: {
          audio: bytesToBase64(wav),
          format: "wav",
          durationSeconds: Math.round(elapsedSeconds),
          context: { garden_id: gardenId },
        },
      });
      if (res.error) throw res.error;
      const data = (res.data ?? {}) as { birds?: BirdDetection[]; summary?: string; error?: string };
      if (data.error) throw new Error(data.error);

      const birds = Array.isArray(data.birds) ? data.birds : [];
      setDetections(birds);
      setSummary(data.summary || "");

      if (birds.length > 0) {
        const plan = planLifeListUpserts(birds, lifeList, {
          userId,
          gardenId,
          nowIso: new Date().toISOString(),
        });
        if (plan.inserts.length > 0) {
          const { error } = await supabase.from("animal_life_list").insert(plan.inserts);
          if (error) throw error;
        }
        for (const update of plan.updates) {
          const { id, ...fields } = update;
          const { error } = await supabase.from("animal_life_list").update(fields).eq("id", id);
          if (error) throw error;
        }
        setNewKeys(plan.newSpeciesKeys);
        await loadLifeList();
        toast.success(
          plan.inserts.length > 0
            ? `${plan.inserts.length} ny${plan.inserts.length === 1 ? "" : "e"} art${plan.inserts.length === 1 ? "" : "er"} føjet til livslisten`
            : "Livslisten er opdateret",
        );
      } else {
        setNewKeys([]);
      }
    } catch (e: unknown) {
      setDetections(null);
      setSummary("");
      toast.error(errorMessage(e, "AI kunne ikke analysere optagelsen"));
    } finally {
      stoppingRef.current = false;
      setPhase("idle");
      setSecondsLeft(LISTEN_SECONDS);
    }
  }, [gardenId, lifeList, loadLifeList, teardownRecorder, userId]);

  const startListening = useCallback(async () => {
    if (phase !== "idle") return;
    setDetections(null);
    setSummary("");
    setNewKeys([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(context.destination);
      recorderRef.current = { stream, context, source, processor, chunks, startedAt: Date.now() };

      setSecondsLeft(LISTEN_SECONDS);
      setPhase("recording");
      timerRef.current = setInterval(() => {
        setSecondsLeft((current) => {
          if (current <= 1) {
            void stopAndAnalyze();
            return 0;
          }
          return current - 1;
        });
      }, 1000);
    } catch (e: unknown) {
      teardownRecorder();
      setPhase("idle");
      toast.error(errorMessage(e, "Kunne ikke få adgang til mikrofonen"));
    }
  }, [phase, stopAndAnalyze, teardownRecorder]);

  const progress = Math.round(((LISTEN_SECONDS - secondsLeft) / LISTEN_SECONDS) * 100);

  return (
    <section className="companion-band bird-listener" aria-label="Fuglelytter">
      <div className="companion-section-head">
        <div>
          <div className="companion-eyebrow">Fuglelytter</div>
          <h2>Lyt med haven i 60 sekunder.</h2>
          <p>
            Tænd mikrofonen, og lad AI genkende fuglestemmerne omkring dig. Hver art gemmes automatisk på din
            livsliste over dyr i haven.
          </p>
        </div>
      </div>

      <div className="bird-listener-grid">
        <div className="bird-listener-stage">
          {phase === "recording" ? (
            <>
              <div
                className="bird-listener-ring"
                style={{ "--progress": `${progress}%` } as CSSProperties}
                role="timer"
                aria-label={`Lytter, ${secondsLeft} sekunder tilbage`}
              >
                <Ear size={22} aria-hidden />
                <span>{secondsLeft}</span>
                <small>sek. tilbage</small>
              </div>
              <p>Hold telefonen stille, og lad haven synge.</p>
              <Button variant="outline" onClick={() => void stopAndAnalyze()}>
                <Square size={14} className="mr-1.5" /> Stop og analysér nu
              </Button>
            </>
          ) : phase === "analyzing" ? (
            <>
              <div className="bird-listener-ring is-analyzing" aria-hidden>
                <Loader2 size={26} className="animate-spin" />
              </div>
              <p>AI lytter optagelsen igennem efter fuglestemmer...</p>
            </>
          ) : (
            <>
              <div className="bird-listener-ring is-idle" aria-hidden>
                <Bird size={30} />
              </div>
              <p>Bedst ved daggry og i stille vejr — men prøv når som helst.</p>
              <Button onClick={() => void startListening()}>
                <Mic size={15} className="mr-1.5" /> Lyt efter fugle (60 sek.)
              </Button>
            </>
          )}
        </div>

        <div className="bird-listener-results">
          {detections === null ? (
            <div className="wildlife-empty">
              <Feather size={16} />
              Ingen lytterunde endnu. Resultatet vises her, og nye arter lander på livslisten.
            </div>
          ) : detections.length === 0 ? (
            <div className="wildlife-empty">
              <Feather size={16} />
              {summary || "Ingen fugle genkendt denne gang. Prøv igen ved daggry eller tættere på buske og træer."}
            </div>
          ) : (
            <>
              {summary && <p className="bird-listener-summary">{summary}</p>}
              <ul className="bird-listener-detections">
                {detections.map((bird, index) => (
                  <li key={`${bird.name_da}-${index}`}>
                    <Bird size={16} aria-hidden />
                    <div>
                      <strong>{bird.name_da}</strong>
                      {bird.latin && <em>{bird.latin}</em>}
                      <small>
                        {confidenceLabel(bird.confidence)}
                        {bird.sound_type ? ` · ${bird.sound_type}` : ""}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="bird-listener-lifelist" aria-label="Livsliste for dyr">
        <div className="bird-listener-lifelist-head">
          <h3>
            Livsliste <span>{lifeList.length} art{lifeList.length === 1 ? "" : "er"}</span>
          </h3>
          <small>Alle dyr, der er registreret i din have — fuglelytteren tilføjer automatisk.</small>
        </div>
        {lifeList.length === 0 ? (
          <div className="wildlife-empty">
            <Bird size={16} />
            Livslisten er tom endnu. Start en lytterunde, og de første fugle dukker op her.
          </div>
        ) : (
          <ul className="bird-listener-lifelist-grid">
            {lifeList.map((row) => (
              <li key={row.id} className={newKeys.includes(row.species_key) ? "is-new" : ""}>
                <div className="bird-listener-lifelist-name">
                  <Bird size={15} aria-hidden />
                  <strong>{row.name_da}</strong>
                  {newKeys.includes(row.species_key) && <span className="bird-listener-new">Ny</span>}
                </div>
                {row.latin && <em>{row.latin}</em>}
                <small>
                  Hørt {row.observation_count} gang{row.observation_count === 1 ? "" : "e"} · første gang{" "}
                  {formatDate(row.first_observed_at)} · senest {formatDate(row.last_observed_at)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
