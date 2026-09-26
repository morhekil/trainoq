import { useState } from "react";
import { dayToText, formatDateLong, formatDateShort } from "../../../shared/days/format";
import { Icon } from "../../icons";
import { Modal } from "../../modal";
import { getEntry } from "./store";

export function ShareSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const doc = getEntry(date)?.doc;
  const text = doc ? dayToText(doc) : formatDateLong(date);
  const canShare = typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("Copied");
    } catch {
      setFeedback("Couldn't copy – select the text and copy it");
    }
  };

  return (
    <Modal variant="sheet" label="Share day" onClose={onClose}>
      <div className="sheet share">
        <div className="sheet-title">Share {formatDateShort(date)}</div>
        <pre className="share-text" data-testid="share-text">
          {text}
        </pre>
        <div className="share-actions">
          {canShare && (
            <button
              type="button"
              className="btn primary"
              onClick={() => navigator.share({ title: `Training – ${formatDateLong(date)}`, text }).catch(() => {})}
            >
              <Icon name="share" size={18} />
              Share…
            </button>
          )}
          <button type="button" className={`btn ${canShare ? "secondary" : "primary"}`} onClick={copy}>
            <Icon name="copy" size={18} />
            Copy text
          </button>
        </div>
        {feedback && <div className="copy-feedback" role="status">{feedback}</div>}
        <button type="button" className="sheet-btn cancel" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
