// RaaS Phase 4 panels: runbook checklists + provider-agnostic communications.
// Appended to OpsPage via import (keeps OpsPage.jsx focused on generic tabs).

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import EmptyState from '../components/EmptyState';

export function RunbookPanel({ eventId }) {
  const [items, setItems] = useState(null);

  const load = async () => {
    try {
      setItems(await api.getRunbook(eventId));
    } catch (err) {
      toast.error(err.message);
    }
  };

  useEffect(() => { load(); }, [eventId]);

  const materialize = async () => {
    try {
      await api.materializeRunbook(eventId);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggle = async (item) => {
    try {
      const updated = await api.checkRunbookItem(item.id, !item.done);
      setItems((list) => list.map((x) => (x.id === item.id ? updated : x)));
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (items === null) return <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>;
  if (items.length === 0) {
    return (
      <div className="card p-5 text-center space-y-3">
        <p className="font-semibold">No runbook yet</p>
        <p className="text-sm text-[var(--color-text-secondary)]">Generate the template checklist for this event.</p>
        <button onClick={materialize} className="btn btn-primary btn-sm mx-auto">Generate checklist</button>
      </div>
    );
  }

  const phases = ['BEFORE', 'DURING', 'AFTER'];
  const labels = { BEFORE: 'Before event', DURING: 'During event', AFTER: 'After event' };
  return (
    <div className="space-y-4">
      {phases.map((ph) => {
        const list = items.filter((i) => i.phase === ph);
        if (list.length === 0) return null;
        const done = list.filter((i) => i.done).length;
        return (
          <div key={ph}>
            <h2 className="section-title">{labels[ph]} ({done}/{list.length})</h2>
            <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden">
              {list.map((item) => (
                <button key={item.id} onClick={() => toggle(item)} className="w-full p-3.5 flex items-center gap-3 text-left active:bg-[var(--color-surface-hover)]">
                  <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${item.done ? 'bg-green-500 border-green-500 text-white' : 'border-[var(--color-border)]'}`}>
                    {item.done && <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                  </span>
                  <span className={`text-[14px] ${item.done ? 'line-through text-[var(--color-text-secondary)]' : 'font-medium'}`}>{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'IN_APP', 'OPERATOR'];

export function CommsPanel({ eventId }) {
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ channel: 'WHATSAPP', recipients_text: '', message: '' });
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try {
      setList(await api.getComms(eventId));
    } catch (err) {
      toast.error(err.message);
    }
  };

  useEffect(() => { load(); }, [eventId]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.message.trim()) return;
    try {
      await api.createComm({ event_id: Number(eventId), ...form });
      toast.success('Logged — send via the channel app, then mark sent');
      setForm({ channel: 'WHATSAPP', recipients_text: '', message: '' });
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const mark = async (id, to) => {
    try {
      await api.setCommStatus(id, to);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-3">
      <button onClick={() => setShowForm(!showForm)} className="btn btn-primary btn-sm w-full">+ Log communication</button>
      {showForm && (
        <form onSubmit={submit} className="card p-4 space-y-2 animate-scale-in">
          <div className="grid grid-cols-2 gap-2">
            <select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} className="input-field">
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={form.recipients_text} onChange={(e) => setForm((f) => ({ ...f, recipients_text: e.target.value }))} placeholder="To (e.g. All guests)" className="input-field" />
          </div>
          <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} rows={3} required placeholder="Message *" className="input-field resize-none" />
          <button type="submit" className="btn btn-primary w-full">Save</button>
        </form>
      )}
      {list === null ? <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p> : list.length === 0 ? (
        <EmptyState title="No communications" message="Log guest/organizer messages here so nothing lives only in chat apps." />
      ) : (
        <div className="space-y-2">
          {list.map((c) => (
            <div key={c.id} className="card p-4 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="badge badge-primary">{c.channel}</span>
                <span className="badge badge-gray">{c.status}</span>
              </div>
              <p className="text-[14px]">{c.message}</p>
              {c.recipients_text && <p className="text-[12px] text-[var(--color-text-secondary)]">To: {c.recipients_text}</p>}
              {c.status !== 'SENT' && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => mark(c.id, 'SENT')} className="btn btn-success btn-sm">Mark sent</button>
                  {c.status !== 'FAILED' && <button onClick={() => mark(c.id, 'FAILED')} className="btn btn-ghost btn-sm text-red-500">Failed</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
