(function (global) {
  'use strict';
  const KEY = 'qinshui-daily-sales-progress-v1';
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const valid = (entry,length) => entry && integer(entry.replayed) && entry.replayed <= length
    && integer(entry.flowCursor) && integer(entry.flowTick) && Number.isFinite(entry.flowEpoch);
  // Compare the accounting records themselves. Re-importing the same receipts
  // must not restart accumulation; a changed amount/source must not reuse it.
  function signature(events) {
    return JSON.stringify(events.map(event => [event.key || event.id || '', event.code || '', event.kind || '',
      event.sourceDate || event.date || '', Number.isInteger(event.amountCents) ? event.amountCents : Math.round(event.amount * 100)]));
  }
  class DailySalesProgress {
    constructor(storage, today) { this.storage = storage; this.today = today; this.available = true; }
    read() {
      try {
        const value = JSON.parse(this.storage.getItem(KEY) || 'null');
        return value?.version === 1 && value.date === this.today() && value.entries && typeof value.entries === 'object'
          ? value : { version: 1, date: this.today(), entries: {} };
      } catch (_) { return { version: 1, date: this.today(), entries: {} }; }
    }
    selection() { return this.read().selection || null; }
    restore(slot, events) {
      const entry = this.read().entries[slot];
      if (!valid(entry,events.length) || entry.signature !== signature(events)) return null;
      return { replayed: entry.replayed, flowCursor: entry.flowCursor, flowTick: entry.flowTick, flowEpoch: entry.flowEpoch };
    }
    save(slot, events, state) {
      const record = this.read(), previous = record.entries[slot], sourceSignature = signature(events);
      const entry = { signature: sourceSignature, replayed: Math.min(events.length, Math.max(0, state.replayed)),
        flowCursor: state.flowCursor, flowTick: state.flowTick, flowEpoch: state.flowEpoch };
      // An older tab may rotate its ledger, but must not overwrite newer sales.
      if (state.accumulationPolicy !== 'clock-cutoff' && previous?.signature === sourceSignature && valid(previous,events.length) && previous.replayed > entry.replayed) {
        Object.assign(entry, { replayed: previous.replayed, flowCursor: previous.flowCursor, flowTick: previous.flowTick, flowEpoch: previous.flowEpoch });
      }
      record.entries[slot] = entry;
      record.selection = { mode: state.mode, source: state.source, day: state.day };
      try { this.storage.setItem(KEY, JSON.stringify(record)); this.available = true; }
      catch (_) { this.available = false; }
      return entry;
    }
  }
  DailySalesProgress.KEY = KEY;
  global.DailySalesProgress = DailySalesProgress;
})(window);
