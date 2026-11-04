'use client';

import { useState, useTransition } from 'react';
import { checkMessage, type Button } from '@/lib/outreach';
import { clickStepAction, repliedAction } from './actions';

export interface CardProps {
  leadId: string;
  name: string;
  title: string | null;
  company: string | null;
  linkedinUrl: string | null;
  researchStatus: string;
  status: string;
  nextActionAt: string | null;
  /** label / management / agency; null when the company type has no messages. */
  messageType: string | null;
  disqualifyReason: string | null;
  planUrl: string | null;
  score: number | null;
  artist: { name: string; listeners: number | null; extra: string[] } | null;
  ready: boolean;
  action: string;
  buttons: Button[];
  canReply: boolean;
  /** Present when one of the buttons sends a message. */
  message: { text: string; templateKey: string | null; version: string | null; templateTitle: string | null } | null;
  noteLimit: number | null;
}

const fmt = (n: number | null) => (n == null ? '–' : n.toLocaleString('en-US'));

export function LeadCard(p: CardProps) {
  const [text, setText] = useState(p.message?.text ?? '');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const check = checkMessage(text, p.noteLimit);
  const run = (fn: () => Promise<{ error: string | null }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res.error) setError(res.error);
    });

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {p.linkedinUrl ? (
          <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
            {p.name}
          </a>
        ) : (
          <span className="font-semibold">
            {p.name} <span className="text-xs font-normal text-slate-400">(no LinkedIn yet)</span>
          </span>
        )}
        <span className="text-sm text-slate-600">
          {[p.title, p.company].filter(Boolean).join(' · ')}
        </span>
        <span className="ml-auto flex gap-2 text-xs">
          {p.messageType && <span className="rounded bg-indigo-100 px-2 py-0.5 text-indigo-800">{p.messageType}</span>}
          {p.ready ? (
            <span className="rounded bg-slate-100 px-2 py-0.5">{p.status}</span>
          ) : p.disqualifyReason ? (
            <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">disqualified: {p.disqualifyReason}</span>
          ) : (
            <span className="rounded bg-amber-100 px-2 py-0.5">research: {p.researchStatus}</span>
          )}
          {p.nextActionAt && <span className="text-slate-500">due {p.nextActionAt}</span>}
          {p.score != null && <span className="text-slate-400">score {p.score}</span>}
        </span>
      </div>

      {p.artist && (
        <div className="mt-1 text-sm">
          <span className="font-medium">{p.artist.name}</span>
          <span className="text-slate-600"> · {fmt(p.artist.listeners)} monthly listeners</span>
          {p.artist.extra.map((e) => (
            <span key={e} className="text-slate-500"> · {e}</span>
          ))}
        </div>
      )}

      {p.planUrl && (
        <a href={p.planUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-indigo-700 underline">
          Plan (one-pager)
        </a>
      )}

      {p.ready && (
        <>
          <p className="mt-3 text-sm font-medium">{p.action}</p>

          {p.message && (
            <div className="mt-2">
              {p.message.templateTitle && (
                <p className="mb-1 text-xs text-slate-500">
                  {p.message.templateTitle} · version {p.message.version}
                </p>
              )}
              {p.message.templateKey && text === '' && p.noteLimit !== null && (
                <p className="mb-1 text-xs text-slate-500">No note: send the connection request without a note.</p>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={Math.min(12, Math.max(3, text.split('\n').length + 1))}
                placeholder={p.message.templateKey ? '' : 'Write the message here (optional)'}
                className="w-full rounded border border-slate-300 p-2 text-sm"
              />
              <div className="mt-1 flex items-center gap-3 text-xs">
                {p.noteLimit !== null && (
                  <span className={check.length > p.noteLimit ? 'text-red-600' : 'text-slate-500'}>
                    {check.length}/{p.noteLimit}
                  </span>
                )}
                {check.problems.map((pr) => (
                  <span key={pr} className="text-red-600">{pr}</span>
                ))}
                <button
                  onClick={copy}
                  disabled={!check.canCopy || text === ''}
                  className="ml-auto rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {p.buttons.map((b) => (
              <button
                key={b.id}
                disabled={pending || (b.sends === true && !check.canCopy)}
                onClick={() =>
                  run(() =>
                    clickStepAction({
                      leadId: p.leadId,
                      fromStatus: p.status,
                      buttonId: b.id,
                      text: b.sends ? text : null,
                      templateKey: p.message?.templateKey ?? null,
                      version: p.message?.version ?? null,
                    }),
                  )
                }
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                {b.label}
              </button>
            ))}

            {p.canReply && (
              <button
                disabled={pending}
                onClick={() => run(() => repliedAction({ leadId: p.leadId, fromStatus: p.status }))}
                className="ml-auto rounded border border-slate-900 px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Replied
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
