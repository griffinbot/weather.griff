import { useState } from "react";
import { Loader2, MessageSquareText, SendHorizonal } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import type { SavedLocationRecord } from "../../shared/contracts";

export function AskDialog({
  open,
  onOpenChange,
  location,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: SavedLocationRecord | null;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!location || !question.trim()) return;
    setLoading(true);
    try {
      const response = await fetch("/api/assistant/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, location }),
      });
      const payload = (await response.json()) as { answer?: string };
      setAnswer(payload.answer || "No answer was generated.");
    } catch {
      setAnswer("The assistant endpoint is unavailable right now.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-[28px] border-slate-200">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-orange-100 p-2 text-orange-700">
              <MessageSquareText className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Ask the Briefing</DialogTitle>
              <DialogDescription>Deterministic backend answers using current briefing and winds data.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={location ? `Ask about ${location.airport} winds, forecast, or reports...` : "Select a location first"}
            className="min-h-28 rounded-[20px]"
          />
          <Button className="rounded-xl bg-slate-950 hover:bg-slate-800" disabled={!location || !question.trim() || loading} onClick={submit}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SendHorizonal className="mr-2 h-4 w-4" />}
            Ask
          </Button>

          {answer && (
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              {answer}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
