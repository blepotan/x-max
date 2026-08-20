(function (root) {
  'use strict';

  const ui = root.XMaxUI || {};
  let componentId = 0;

  function enhanceSelect(select) {
    if (!select || select.dataset.xmaxEnhanced === 'true') return null;
    select.dataset.xmaxEnhanced = 'true';
    select.classList.add('xmax-native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const id = `xmax-select-${++componentId}`;
    const label = select.id ? root.document.querySelector(`label[for="${select.id}"]`) : null;
    if (label && !label.id) label.id = `${id}-label`;

    const component = root.document.createElement('div');
    component.className = 'select-component';
    const trigger = root.document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-trigger';
    trigger.id = `${id}-trigger`;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const value = root.document.createElement('span');
    value.className = 'select-value';
    value.id = `${id}-value`;
    trigger.setAttribute('aria-labelledby', [label && label.id, value.id].filter(Boolean).join(' '));
    const chevron = root.document.createElement('span');
    chevron.className = 'select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(value, chevron);

    const popover = root.document.createElement('div');
    popover.className = 'select-popover';
    popover.id = `${id}-listbox`;
    popover.setAttribute('role', 'listbox');
    popover.hidden = true;
    trigger.setAttribute('aria-controls', popover.id);

    const options = Array.from(select.options).map((nativeOption, index) => {
      const option = root.document.createElement('button');
      option.type = 'button';
      option.className = 'select-option';
      option.id = `${id}-option-${index}`;
      option.setAttribute('role', 'option');
      option.dataset.value = nativeOption.value;
      option.textContent = nativeOption.textContent;
      option.addEventListener('click', () => {
        select.value = nativeOption.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        close(true);
      });
      popover.appendChild(option);
      return option;
    });

    function sync() {
      const selected = Array.from(select.options).find((option) => option.value === select.value) || select.options[0];
      value.textContent = selected ? selected.textContent : '';
      options.forEach((option) => {
        const active = option.dataset.value === select.value;
        option.setAttribute('aria-selected', String(active));
        option.dataset.selected = String(active);
      });
    }

    function open() {
      popover.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      component.dataset.open = 'true';
      const selected = options.find((option) => option.dataset.selected === 'true') || options[0];
      if (selected) selected.focus();
    }

    function close(returnFocus) {
      popover.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      delete component.dataset.open;
      if (returnFocus) trigger.focus();
    }

    function moveFocus(direction) {
      const index = Math.max(0, options.indexOf(root.document.activeElement));
      const next = (index + direction + options.length) % options.length;
      options[next].focus();
    }

    trigger.addEventListener('click', () => popover.hidden ? open() : close(false));
    if (label) {
      label.addEventListener('click', (event) => {
        event.preventDefault();
        trigger.focus();
      });
    }
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open();
      }
    });
    popover.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(-1); }
      else if (event.key === 'Home') { event.preventDefault(); options[0].focus(); }
      else if (event.key === 'End') { event.preventDefault(); options[options.length - 1].focus(); }
    });
    root.document.addEventListener('pointerdown', (event) => {
      if (!popover.hidden && !component.contains(event.target)) close(false);
    });
    select.addEventListener('change', sync);
    component.append(trigger, popover);
    select.insertAdjacentElement('afterend', component);
    sync();
    return { element: component, trigger, popover, open, close, sync, select };
  }

  function enhanceCombobox(input, items) {
    if (!input || input.dataset.xmaxEnhanced === 'true') return null;
    input.dataset.xmaxEnhanced = 'true';
    const id = `xmax-combobox-${++componentId}`;
    const values = Array.from(new Set((items || []).map(String)));
    const label = input.id ? root.document.querySelector(`label[for="${input.id}"]`) : null;
    if (label && !label.id) label.id = `${id}-label`;

    const component = root.document.createElement('div');
    component.className = 'combobox-component';
    input.insertAdjacentElement('beforebegin', component);
    component.appendChild(input);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    const toggle = root.document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'combobox-toggle';
    toggle.setAttribute('aria-label', 'Show time zones');
    const chevron = root.document.createElement('span');
    chevron.className = 'select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggle.appendChild(chevron);

    const popover = root.document.createElement('div');
    popover.className = 'select-popover combobox-popover';
    popover.id = `${id}-listbox`;
    popover.setAttribute('role', 'listbox');
    popover.hidden = true;
    input.setAttribute('aria-controls', popover.id);
    if (label) input.setAttribute('aria-labelledby', label.id);
    component.append(toggle, popover);
    let renderedOptions = [];
    let activeIndex = -1;
    let filtering = false;

    function filteredValues() {
      if (!filtering) return values;
      const query = input.value.trim().toLowerCase();
      if (!query) return values;
      return values.filter((value) => value.toLowerCase().includes(query));
    }

    function render() {
      popover.replaceChildren();
      activeIndex = -1;
      renderedOptions = filteredValues().map((item, index) => {
        const option = root.document.createElement('button');
        option.type = 'button';
        option.className = 'select-option';
        option.id = `${id}-option-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(item === input.value));
        option.dataset.selected = String(item === input.value);
        option.textContent = item;
        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('click', () => selectValue(item));
        popover.appendChild(option);
        return option;
      });
      if (!renderedOptions.length) {
        const empty = root.document.createElement('p');
        empty.className = 'combobox-empty';
        empty.textContent = 'Use the full IANA time zone name.';
        popover.appendChild(empty);
      }
    }

    function open() {
      render();
      popover.hidden = false;
      component.dataset.open = 'true';
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      popover.hidden = true;
      delete component.dataset.open;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
      filtering = false;
    }

    function selectValue(value) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      close();
      input.focus();
    }

    function moveActive(direction) {
      if (!renderedOptions.length) return;
      activeIndex = (activeIndex + direction + renderedOptions.length) % renderedOptions.length;
      renderedOptions.forEach((option, index) => option.dataset.active = String(index === activeIndex));
      const active = renderedOptions[activeIndex];
      input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('focus', () => { filtering = false; open(); });
    input.addEventListener('input', () => { filtering = true; open(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); if (popover.hidden) open(); moveActive(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); if (popover.hidden) open(); moveActive(-1); }
      else if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); selectValue(renderedOptions[activeIndex].textContent); }
      else if (event.key === 'Escape') { event.preventDefault(); close(); }
    });
    toggle.addEventListener('click', () => {
      if (popover.hidden) { input.focus(); open(); }
      else { close(); input.focus(); }
    });
    root.document.addEventListener('pointerdown', (event) => {
      if (!popover.hidden && !component.contains(event.target)) close();
    });
    return { element: component, input, toggle, popover, open, close, render, sync: render };
  }

  ui.enhanceSelect = enhanceSelect;
  ui.enhanceCombobox = enhanceCombobox;
  root.XMaxUI = ui;
})(typeof globalThis !== 'undefined' ? globalThis : window);
