'use strict';

class VirtualList {
  constructor(maxDomNodes = 80) {
    this.maxDomNodes = Math.max(20, Number(maxDomNodes) || 80);
    this.items = [];
    this.windowStart = 0;
  }

  setItems(items) {
    this.items = Array.isArray(items) ? items.slice() : [];
    this.windowStart = Math.max(0, this.items.length - this.maxDomNodes);
    return this.getWindow();
  }

  append(items) {
    const list = Array.isArray(items) ? items : [items];
    this.items.push(...list.filter(Boolean));
    this.windowStart = Math.max(0, this.items.length - this.maxDomNodes);
    return this.getWindow();
  }

  prepend(items) {
    const list = Array.isArray(items) ? items : [items];
    this.items.unshift(...list.filter(Boolean));
    this.windowStart += list.length;
    this.windowStart = Math.min(
      this.windowStart,
      Math.max(0, this.items.length - this.maxDomNodes)
    );
    return this.getWindow();
  }

  getWindow() {
    const end = Math.min(this.items.length, this.windowStart + this.maxDomNodes);
    return {
      items: this.items.slice(this.windowStart, end),
      start: this.windowStart,
      end,
      total: this.items.length,
    };
  }
}

if (typeof window !== 'undefined') {
  window.VirtualList = VirtualList;
}

if (typeof module !== 'undefined') {
  module.exports = { VirtualList };
}
