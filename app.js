(() => {
      "use strict";
      const STORAGE_KEY = "gnucash-mobile-capture-v1";
      const defaults = {
        accounts: [
          { id: "cumulus", label: "Cumulus", path: "Assets:Creditcards:Cumulus Credit Card", currency: "CHF" },
          { id: "certo", label: "Certo", path: "Assets:Creditcards:Certo Credit Card", currency: "CHF" },
          { id: "revn2", label: "REV-N2", path: "Assets:Nico:REV-N2", currency: "CHF" },
          { id: "revg", label: "REV-G", path: "Assets:Gio:REV-G", currency: "EUR" },
          { id: "ubsg", label: "UBS-G", path: "Assets:Gio:UBS-G", currency: "CHF" },
          { id: "ubsn", label: "UBS-N", path: "Assets:Nico:UBS-N", currency: "CHF" }
        ],
        necessaryPath: "Expenses:Necessary", leisurePath: "Expenses:Leisure", nicoSharePercent:43, gioSharePercent:57,
        categories: ["Food", "Transport", "Shopping", "Fun", "Health", "Housing", "Work", "Cat"]
      };
      const store = CaptureStorage.create(localStorage, STORAGE_KEY, raw => CaptureCore.validateState(raw, defaults), () => ({config:clone(defaults),entries:[],presets:[]}));
      let state = store.read();
      let fxGeneration = 0;
      function invalidateFx() { fxGeneration++; if (document.getElementById("fetch-fx")?.disabled) document.getElementById("fx-status").textContent = "Entry changed; the pending rate will not be applied. Confirm your current rate."; }
      let transactionCurrency = null, manualFx = false, ubsSplitChoice = null, quickPreset = null, quickOpen = false;
      let type = null, spendingClass = null, editingId = null, fxSource = "manual", currentStep = "type", customCategoryMode = false;
      const $ = (id) => document.getElementById(id);
      const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const today = () => dateString(new Date());
      function showView(view) {
        cancelAdvance(); invalidateFx();
        document.querySelectorAll("[data-view]").forEach((section) => section.classList.toggle("hidden", section.dataset.view !== view));
        document.querySelectorAll("[data-nav]").forEach((button) => { if (button.dataset.nav === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); });
        window.scrollTo({ top:0, behavior:"instant" });
      }
      function renderReview() {
        const rows = [["Type", type ? type[0].toUpperCase() + type.slice(1) : "—"], ...(type === "transfer" ? [["To", selectedToAccount()?.label || "—"]] : [["Class", spendingClass || "—"], ["Category", $("title").value]]), ["Account", selectedAccount()?.label || "—"], ["Date", $("date").value], ["Amount", money($("amount").value, selectedCurrency())], ...(number($("chf-amount").value) > 0 ? [["CHF equivalent", money($("chf-amount").value, "CHF")]] : [])];
        rows.push(["Detail / merchant", $("memo").value || "—"]);
        const linked = state.entries.find(item => item.generatedFrom === editingId);
        if (ubsSplitChoice || linked) { const split = ubsSplitDetails(); rows.push(["Reimbursement", `${split.from.label} → ${split.to.label}: ${money(split.amount,"CHF")} (${split.percentage}%)`]); }
        if (number($("fx-rate").value)>0) rows.push(["EUR → CHF rate", `${$("fx-rate").value} · ${$("fx-date").value}`]);
        $("optional-fx").classList.toggle("hidden", !(selectedCurrency() === "EUR" && type !== "transfer" && !needsFx()));
        $("review-summary").innerHTML = `<dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
      }

      function clone(value) { return JSON.parse(JSON.stringify(value)); }
      function storageNotice(message) { $("storage-status").textContent = message; $("storage-status").className = "status error"; }
      function persist(restoring = false) {
        try { state = store.save(state, restoring); storageNotice(""); }
        catch (error) {
          state = store.read(); storageNotice(`Changes were not saved. Your form is still available. ${error.message}`);
          error.captureStorage = true; throw error;
        }
      }
      function uid() { return crypto.randomUUID ? crypto.randomUUID() : `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
      function escapeHtml(value) { return String(value).replace(/[&<>"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[character]); }
      function number(value) {
        const normalized = String(value ?? "").trim().replace(",", ".");
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
      }
      function money(value, currency) { return new Intl.NumberFormat("de-CH", { style:"currency", currency, minimumFractionDigits:2 }).format(number(value)); }
      function account(id) { return state.config.accounts.find((item) => item.id === id); }
      function selectedAccount() { return account($("account").value); }
      function selectedToAccount() { return account($("to-account").value); }
      function isRevolut() { return ["revg", "revn2"].includes(selectedAccount()?.id); }
      function sharedSplitOwner(item) {
        if (!item) return null;
        if (item.id === "ubsg") return "gio";
        if (item.id === "ubsn") return "nico";
        const text = `${item.label || ""} ${item.path || ""}`.toLowerCase();
        if (/\b(?:gio|g)\b/.test(text) && /ubs/.test(text)) return "gio";
        if (/\b(?:nico|n)\b/.test(text) && /ubs/.test(text)) return "nico";
        return null;
      }
      function canOfferUbsSplit() { return !editingId && type === "expense" && selectedCurrency() === "CHF" && account("ubsg")?.currency === "CHF" && account("ubsn")?.currency === "CHF" && Boolean(sharedSplitOwner(selectedAccount())); }
      function ubsSplitDetails() {
        const paidByGio = sharedSplitOwner(selectedAccount()) === "gio";
        const percentage = paidByGio ? Number(state.config.nicoSharePercent ?? 43) : Number(state.config.gioSharePercent ?? 57);
        const amount = number($("amount").value) || 0;
        return {
          from: paidByGio ? account("ubsn") : account("ubsg"),
          to: selectedAccount(),
          percentage,
          amount: amount > 0 ? Number(CaptureCore.share($("amount").value, percentage)) : 0,
        };
      }
      function selectedCurrency() { return (isRevolut() && transactionCurrency) || selectedAccount()?.currency || "CHF"; }
      function clearCurrencyChoice() { invalidateFx(); transactionCurrency = null; manualFx = false; $("fx-rate").value = ""; $("chf-amount").value = ""; fxSource = "manual"; }
      function updateCurrencyChoices() {
        document.querySelectorAll("[data-currency]").forEach((button) => { const selected = button.dataset.currency === transactionCurrency; button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected)); });
        $("currency-copy").textContent = `${selectedAccount()?.label || "Revolut"} is a ${selectedAccount()?.currency || "CHF"} account. Choose the currency shown on the transaction.`;
      }
      function setStatus(message, kind = "") { const view = document.querySelector("[data-nav][aria-current=page]")?.dataset.nav; const element = $(view === "drafts" ? "draft-status" : view === "settings" ? "settings-status" : "form-status"); element.textContent = message; element.className = `status ${kind}`; }

      function renderOptions() {
        const options = `<option value="">Choose an account</option>${state.config.accounts.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${item.currency}</option>`).join("")}`;
        const prior = $("account").value, priorTo = $("to-account").value;
        $("account").innerHTML = options; $("to-account").innerHTML = options;
        $("account").value = account(prior) ? prior : "";
        $("to-account").value = account(priorTo) ? priorTo : "";
        $("category-options").innerHTML = state.config.categories.map((item) => `<option value="${escapeHtml(item)}"></option>`).join("");
        renderChoiceButtons();
        renderPresets();
        renderManagedPresets();
      }
      function presetLabel(preset) { return (typeof preset.nickname === "string" && preset.nickname.trim()) || preset.title || "Transfer"; }
      function renderPresets() {
        const presets = state.presets || [];
        $("quick-presets").innerHTML = presets.length ? presets.map((preset) => `<div class="quick-preset"><button type="button" data-preset="${escapeHtml(preset.id)}"><strong>${escapeHtml(presetLabel(preset))}</strong><small>${escapeHtml(account(preset.accountId)?.label || preset.accountId)} · ${escapeHtml(money(preset.amount, preset.currency))}</small></button></div>`).join("") : '<p class="hint">Save a draft as a shortcut from Drafts first.</p>';
      }
      function renderManagedPresets() {
        const container = $("managed-quick-presets");
        if (!container) return;
        const presets = state.presets || [];
        container.innerHTML = presets.length ? presets.map((preset) => `<div class="quick-manage-item"><strong>${escapeHtml(preset.title || "Transfer")}</strong><small>${escapeHtml(account(preset.accountId)?.label || preset.accountId)} · ${escapeHtml(money(preset.amount, preset.currency))}</small><div class="quick-manage-actions"><label>Nickname<input type="text" data-preset-nickname="${escapeHtml(preset.id)}" value="${escapeHtml(preset.nickname || "")}" placeholder="Optional nickname" /></label><button type="button" class="small danger" data-delete-managed-preset="${escapeHtml(preset.id)}">Delete</button></div></div>`).join("") : '<p class="hint">No quick transactions saved yet. Save one from Drafts to use it here.</p>';
      }
      function renderChoiceButtons() {
        const selected = $("account").value, selectedTo = $("to-account").value, title = $("title").value.trim();
        const accountButton = (item, chosen, attribute) => `<button type="button" data-${attribute}="${escapeHtml(item.id)}" class="${chosen === item.id ? "selected" : ""}"><strong>${escapeHtml(item.label)}</strong><small>${item.currency}</small></button>`;
        $("account-choices").innerHTML = state.config.accounts.map((item) => accountButton(item, selected, "account-choice")).join("");
        $("to-account-choices").innerHTML = state.config.accounts.map((item) => accountButton(item, selectedTo, "to-account-choice")).join("");
        $("category-choices").innerHTML = [...state.config.categories.map((item) => `<button type="button" data-category="${escapeHtml(item)}" class="${title === item ? "selected" : ""}">${escapeHtml(item)}</button>`), `<button type="button" data-category="other" class="${title && !state.config.categories.includes(title) ? "selected" : ""}">Other +</button>`].join("");
        $("custom-category").classList.toggle("hidden", !(customCategoryMode || (title && !state.config.categories.includes(title))));
      }
      function renderSettings() {
        $("account-settings").innerHTML = state.config.accounts.map((item) => `<div class="account-setting"><input data-setting-label="${escapeHtml(item.id)}" value="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)} shortcut" /><input data-setting-path="${escapeHtml(item.id)}" value="${escapeHtml(item.path)}" aria-label="${escapeHtml(item.label)} account path" /><select data-setting-currency="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.label)} currency"><option value="CHF" ${item.currency === "CHF" ? "selected" : ""}>CHF</option><option value="EUR" ${item.currency === "EUR" ? "selected" : ""}>EUR</option></select></div>`).join("");
        $("necessary-path").value = state.config.necessaryPath;
        $("leisure-path").value = state.config.leisurePath;
        $("categories").value = state.config.categories.join(", ");
        $("nico-share").value = String(state.config.nicoSharePercent ?? 43);
        $("gio-share").value = String(state.config.gioSharePercent ?? 57);
      }
      function renderEntries() {
        const sorted = [...state.entries].sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        const pendingCount = state.entries.filter((item) => !item.exportedAt).length;
        $("draft-count").textContent = String(pendingCount);
        $("nav-draft-count").textContent = String(pendingCount);
        $("export-csv").disabled = pendingCount === 0;
        $("export-csv").textContent = pendingCount ? `Export all ${pendingCount} unexported draft${pendingCount === 1 ? "" : "s"} · CSV` : "No drafts to export";
        $("clear-exported").disabled = !state.entries.some((item) => item.importedAt && !item.changedSinceExport);
        const query = $("draft-search").value.trim().toLocaleLowerCase();
        const groupBy = $("draft-group-by").value;
        const matches = sorted.filter((entry) => {
          const source = account(entry.accountId), destination = account(entry.toAccountId);
          return [entry.title, entry.memo, entry.date, entry.amount, entry.chfAmount, entry.currency,
            source?.label, source?.path, destination?.label, destination?.path].some(value => String(value || "").toLocaleLowerCase().includes(query));
        });
        $("draft-view-count").textContent = query ? `Showing ${matches.length} of ${sorted.length} drafts` : "";
        const card = (entry) => {
          const source = account(entry.accountId), destination = account(entry.toAccountId);
          const linked = entry.generatedFrom ? "Linked reimbursement" : state.entries.some(item => item.generatedFrom === entry.id) ? "Has linked reimbursement" : "";
          const actions = `${!entry.generatedFrom ? `<button class="small" type="button" data-save-preset="${escapeHtml(entry.id)}">Save quick transaction</button>` : ""}${entry.exportedAt ? `<button class="small" type="button" data-unexport="${escapeHtml(entry.id)}">Mark unexported</button>` : ""}<button class="small danger" type="button" data-delete="${escapeHtml(entry.id)}">Delete</button>`;
          return `<article class="entry"><div class="entry-main"><div><strong>${escapeHtml(entry.title || "Transfer")}</strong><span class="entry-kind">${escapeHtml(entry.type)}</span><small>${escapeHtml(entry.date)} · ${escapeHtml(source?.label || entry.accountId)}${entry.type === "transfer" ? ` → ${escapeHtml(destination?.label || entry.toAccountId)}` : ""}${entry.memo ? ` · ${escapeHtml(entry.memo)}` : ""}${linked ? ` · ${linked}` : ""}</small></div><div class="entry-amount">${escapeHtml(money(entry.amount, entry.currency))}${entry.currency === "EUR" ? `<small>${entry.chfAmount ? escapeHtml(money(entry.chfAmount, "CHF")) : "CHF rate needed"}</small>` : ""}</div></div><div class="entry-actions"><button class="small" type="button" data-edit="${escapeHtml(entry.id)}">Edit</button>${entry.exportedAt && !entry.changedSinceExport && !entry.importedAt ? `<button class="small" type="button" data-imported="${escapeHtml(entry.id)}">Mark imported</button>` : ""}<details class="entry-more"><summary>More</summary><div class="entry-more-actions">${actions}</div></details></div></article>`;
        };
        const grouped = (items) => {
          if (groupBy !== "account" && groupBy !== "category") return items.map(card).join("");
          const groups = new Map();
          for (const entry of items) {
            const key = groupBy === "account" ? entry.accountId : entry.type === "transfer" ? "transfer" : `category:${String(entry.title || "").trim().toLocaleLowerCase()}`;
            const label = groupBy === "account" ? account(entry.accountId)?.label || entry.accountId : entry.type === "transfer" ? "Transfers" : entry.title || "Uncategorized";
            if (!groups.has(key)) groups.set(key, {label, entries:[]});
            groups.get(key).entries.push(entry);
          }
          return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)).map(group => `<details class="draft-group" open><summary>${escapeHtml(group.label)} <span class="draft-count">${group.entries.length}</span></summary>${group.entries.map(card).join("")}</details>`).join("");
        };
        const sections = [
          ["attention", "Needs attention", entry => Boolean(entry.exportedAt && entry.changedSinceExport)],
          ["pending", "To export", entry => !entry.exportedAt],
          ["downloaded", "Downloaded — confirm import", entry => Boolean(entry.exportedAt && !entry.changedSinceExport && !entry.importedAt)],
          ["imported", "Imported", entry => Boolean(entry.exportedAt && !entry.changedSinceExport && entry.importedAt)]
        ];
        $("entries").innerHTML = !sorted.length ? '<div class="empty-state"><span class="type-icon" aria-hidden="true">▤</span><h3>A little less to remember.</h3><p>Capture an expense, refund, or transfer.<br>Your drafts will be waiting here.</p><button type="button" data-start-capture class="primary">Capture a transaction</button></div>'
          : !matches.length ? '<p class="draft-empty">No drafts match your search.</p>'
          : sections.map(([key, title, includes]) => {
            const items = matches.filter(includes);
            return items.length ? `<details class="draft-section draft-${key}" ${key === "imported" && !query ? "" : "open"}><summary>${title} <span class="draft-count">${items.length}</span></summary><div class="draft-section-body">${grouped(items)}</div></details>` : "";
          }).join("");
      }
      function updateTypeUI() {
        document.querySelectorAll("[data-type]").forEach((button) => { button.classList.toggle("selected", button.dataset.type === type); button.setAttribute("aria-pressed", String(button.dataset.type === type)); });
        document.querySelectorAll("[data-class]").forEach((button) => { button.classList.toggle("selected", button.dataset.class === spendingClass); button.setAttribute("aria-pressed", String(button.dataset.class === spendingClass)); });
        const transfer = type === "transfer";
        $("title").required = Boolean(type) && !transfer;
        $("category-heading").textContent = type === "refund" ? "What is being refunded?" : "What was it for?";
        $("account-heading").textContent = transfer ? "Move money from" : type === "refund" ? "Where did it return to?" : "How was it paid?";
        $("account-copy").textContent = transfer ? "Choose both accounts for this internal transfer." : "Tap the account used for this entry.";
        renderChoiceButtons();
        updateFxUI();
        updateStepUI();
      }
      function stepsForType() {
        if (quickOpen && !quickPreset) return ["quick-list"];
        if (quickPreset) return ["quick-amount", ...(needsFx() ? ["fx", "quick-review"] : [])];
        if (!type) return ["type"];
        const steps = type === "transfer" ? ["type", "account"] : ["type", "class", "category", "account"];
        if (isRevolut()) steps.push("currency");
        if (type === "transfer") steps.push("to-account");
        steps.push("date", "amount"); if (needsFx()) steps.push("fx"); steps.push("note");
        if (canOfferUbsSplit()) steps.push("ubs-split");
        return steps;
      }
      function updateDateChoices() {
        document.querySelectorAll("[data-date-offset]").forEach((button) => {
          const date = new Date(); date.setDate(date.getDate() + Number(button.dataset.dateOffset));
          const selected = $("date").value === dateString(date);
          button.classList.toggle("selected", selected);
          button.setAttribute("aria-pressed", String(selected));
        });
      }
      function updateStepUI() {
        updateDateChoices(); updateCurrencyChoices();
        $("capture-context").textContent = editingId ? "Editing draft" : type ? type[0].toUpperCase() + type.slice(1) : "New entry";
        const progressSteps = stepsForType();
        $("capture-progress").value = currentStep === "done" ? 100 : type ? (progressSteps.indexOf(currentStep) / Math.max(1, progressSteps.length - 1)) * 100 : 0;
        if (["note", "quick-review"].includes(currentStep)) renderReview();
        if (currentStep === "done") { document.querySelectorAll("[data-step]").forEach((section) => section.classList.toggle("hidden", section.dataset.step !== "done")); $("step-progress").textContent = "Done"; return; }
        const steps = stepsForType(); if (!steps.includes(currentStep)) currentStep = "type";
        document.querySelectorAll("[data-step]").forEach((section) => section.classList.toggle("hidden", section.dataset.step !== currentStep));
        $("step-progress").textContent = type ? `Step ${steps.indexOf(currentStep) + 1} of ${steps.length}` : "Make a quick note";
        if (currentStep === "amount") { $("amount-copy").textContent = `Enter the amount in ${selectedCurrency()}.`; $("amount").focus({ preventScroll:true }); $("amount").select(); }
        if (currentStep === "quick-amount") {
          $("quick-amount-copy").textContent = `${presetLabel(quickPreset)} · ${selectedCurrency()}`;
          $("quick-summary").innerHTML = `<dl><div><dt>Account</dt><dd>${escapeHtml(selectedAccount()?.label || "—")}</dd></div><div><dt>Category</dt><dd>${escapeHtml(quickPreset.title || "Transfer")}</dd></div><div><dt>Date</dt><dd>Today</dd></div></dl>`;
          renderReview(); $("quick-summary").innerHTML = $("review-summary").innerHTML;
          $("save-quick").classList.toggle("hidden", needsFx()); $("continue-quick").classList.toggle("hidden", !needsFx());
          $("quick-amount").focus({ preventScroll:true }); $("quick-amount").select();
        }
        if (currentStep === "quick-review") $("quick-review-summary").innerHTML = $("review-summary").innerHTML;
        if (currentStep === "ubs-split") {
          const split = ubsSplitDetails();
          $("ubs-split-copy").textContent = `${split.from.label} reimburses ${split.to.label} for the other person's share.`;
          $("ubs-split-summary").innerHTML = `<dl><div><dt>Expense</dt><dd>${escapeHtml(money($("amount").value, "CHF"))}</dd></div><div><dt>${split.from.label} → ${split.to.label}</dt><dd>${split.percentage}% · ${escapeHtml(money(split.amount, "CHF"))}</dd></div></dl>`;
        }
      }
      function stepIsValid(step) {
        if (step === "currency" && !transactionCurrency) { setStatus("Choose CHF or EUR.", "error"); return false; }
        if (step === "date" && !CaptureCore.validDate($("date").value)) { setStatus("Choose a date.", "error"); return false; }
        if (step === "category" && !$("title").value.trim()) { setStatus("Choose a category or add one with Other +.", "error"); return false; }
        if (step === "account" && !selectedAccount()) { setStatus("Choose an account.", "error"); return false; }
        if (step === "to-account" && (!selectedToAccount() || selectedToAccount().id === selectedAccount().id)) { setStatus("Choose a different receiving account.", "error"); return false; }
        if (["amount", "quick-amount"].includes(step)) { try { CaptureCore.minor(step === "quick-amount" ? $("quick-amount").value : $("amount").value); } catch(error) { setStatus(error.message,"error"); return false; } const amount = number(step === "quick-amount" ? $("quick-amount").value : $("amount").value); if (!amount || amount <= 0) { setStatus("Enter a positive amount.", "error"); return false; } }
        if (step === "fx") { const rate = number($("fx-rate").value), amount = number($("chf-amount").value); if (!rate || rate <= 0 || !amount || amount <= 0) { setStatus("Fetch or enter a EUR → CHF rate and CHF equivalent.", "error"); return false; } }
        setStatus(""); return true;
      }
      let advanceTimer = null;
      function cancelAdvance() { clearTimeout(advanceTimer); advanceTimer = null; }
      function advanceAfterChoice() {
        invalidateFx(); cancelAdvance();
        const chosenStep = currentStep;
        advanceTimer = setTimeout(() => {
          advanceTimer = null;
          if (currentStep === chosenStep) moveStep(1);
        }, 500);
      }
      function moveStep(direction) {
        cancelAdvance();
        if (currentStep === "quick-list" && direction < 0) { quickOpen = false; currentStep = "type"; updateStepUI(); return; }
        const steps = stepsForType(), index = steps.indexOf(currentStep);
        if (direction > 0 && !stepIsValid(currentStep)) return;
        currentStep = steps[Math.max(0, Math.min(steps.length - 1, index + direction))]; updateStepUI(); window.scrollTo({ top:0, behavior:"smooth" });
      }
      function needsFx() {
        if (manualFx) return true;
        if (selectedAccount() && selectedCurrency() !== selectedAccount().currency) return true;
        if (type === "transfer") return Boolean(selectedToAccount() && selectedCurrency() !== selectedToAccount().currency);
        return !isRevolut() && selectedCurrency() === "EUR";
      }
      function updateFxUI() {
        const needed = needsFx();
        if (!needed && !number($("fx-rate").value)) $("fx-date").value = $("date").value;
        if (!$("chf-amount").value || selectedCurrency() === "CHF") calculateChf();
        if (needed && !$("fx-date").value) $("fx-date").value = $("date").value;
      }
      function calculateChf() {
        invalidateFx();
        const amount = number($("amount").value), rate = number($("fx-rate").value);
        if (selectedCurrency() === "EUR") { try { $("chf-amount").value = amount && rate ? CaptureCore.convert($("amount").value, $("fx-rate").value) : ""; } catch (_) { $("chf-amount").value = ""; } }
        if (amount && selectedCurrency() === "CHF") $("chf-amount").value = amount.toFixed(2);
      }
      function resetForm() {
        invalidateFx(); cancelAdvance();
        transactionCurrency = null; manualFx = false; ubsSplitChoice = null; quickPreset = null; quickOpen = false; editingId = null; type = null; spendingClass = null; fxSource = "manual"; currentStep = "type"; customCategoryMode = false;
        $("capture-form").reset(); $("date").value = today(); $("fx-date").value = today(); $("fx-rate").value = "";
        renderOptions(); updateTypeUI(); setStatus(""); $("save-entry").textContent = "Save draft";
      }
      function loadEntry(entry) {
        invalidateFx(); quickOpen = false; quickPreset = null; cancelAdvance();
        showView("capture"); transactionCurrency = entry.currency; manualFx = false; ubsSplitChoice = null; editingId = entry.id; type = entry.type; spendingClass = entry.spendingClass || "Necessary";
        renderOptions(); $("date").value = entry.date; $("title").value = entry.title || ""; $("memo").value = entry.memo || ""; $("amount").value = entry.amount; $("account").value = entry.accountId; $("to-account").value = entry.toAccountId || state.config.accounts[0].id;
        $("fx-rate").value = entry.fxRate || ""; $("fx-date").value = entry.fxDate || entry.date; $("chf-amount").value = entry.chfAmount || ""; fxSource = entry.fxSource || "manual";
        currentStep = "note"; customCategoryMode = Boolean(entry.title && !state.config.categories.includes(entry.title)); updateTypeUI(); $("save-entry").textContent = "Update draft"; setStatus("Editing draft. Save to keep your changes.", "good"); window.scrollTo({ top:0, behavior:"smooth" });
      }
      function validateAndSave(event) {
        event.preventDefault();
        if (currentStep === "note" && canOfferUbsSplit() && ubsSplitChoice === null) { currentStep = "ubs-split"; updateStepUI(); return; }
        if (!(["note", "ubs-split", "quick-amount", "quick-review"].includes(currentStep))) return;
        if (quickPreset) { $("amount").value = $("quick-amount").value; }
        calculateChf();
        try { CaptureCore.minor($("amount").value); } catch (error) { return setStatus(error.message, "error"); }
        const source = selectedAccount(), destination = selectedToAccount(), amount = number($("amount").value), rate = number($("fx-rate").value), chfAmount = number($("chf-amount").value);
        if (!source || !amount || amount <= 0) return setStatus("Enter a positive amount and source account.", "error");
        if (type === "transfer" && (!destination || destination.id === source.id)) return setStatus("Choose a different destination account for the transfer.", "error");
        if (type !== "transfer" && !$("title").value.trim()) return setStatus("Choose or enter a category/title.", "error");
        const fxRequired = needsFx();
        if (fxRequired && (!rate || rate <= 0 || !chfAmount || chfAmount <= 0)) return setStatus("Fetch or enter a EUR → CHF rate and CHF equivalent before saving.", "error");
        if (!type || (type !== "transfer" && !spendingClass) || !CaptureCore.validDate($("date").value)) return setStatus("Complete the transaction type, class, and date before saving.", "error");
        if (isRevolut() && !transactionCurrency) return setStatus("Choose the transaction currency before saving.", "error");
        const savedChf = selectedCurrency() === "CHF" ? amount : rate > 0 && chfAmount > 0 ? chfAmount : null;
        const savedRate = rate > 0 && savedChf > 0 ? $("fx-rate").value.trim().replace(",", ".") : null;
        const prior = state.entries.find((item) => item.id === editingId);
        if (prior?.exportedAt && !confirm("This draft was downloaded before. Saving will flag a correction and require you to mark it unexported before downloading again. Check the previous import to avoid duplicates. Continue?")) return;
        const linked = prior && state.entries.find(item => item.generatedFrom === prior.id);
        if (linked && !confirm("Update the linked reimbursement to match this expense and the configured share? Cancel keeps both drafts unchanged.")) return;

        const entry = { id: editingId || uid(), createdAt: prior?.createdAt || new Date().toISOString(), exportedAt: prior?.exportedAt || null, importedAt: prior?.importedAt || null, changedSinceExport: Boolean(prior?.exportedAt), ...(prior?.generatedFrom ? {generatedFrom:prior.generatedFrom} : {}), type, spendingClass: type === "transfer" ? null : spendingClass, title: type === "transfer" ? "Transfer" : $("title").value.trim(), date: $("date").value, memo: $("memo").value.trim(), accountId: source.id, toAccountId: type === "transfer" ? destination.id : null, amount: CaptureCore.fixed(CaptureCore.minor($("amount").value)), currency: selectedCurrency(), accountCurrency: source.currency, fxRate: savedRate, fxDate: savedRate ? ($("fx-date").value || $("date").value) : $("date").value, fxSource: savedRate ? fxSource : "not-applicable", chfAmount: savedChf === null ? null : savedChf.toFixed(2) };
        if (linked) {
          if (type !== "expense" || !sharedSplitOwner(source) || source.currency !== "CHF") return setStatus("Remove the linked reimbursement before changing this expense to a different account or type.", "error");
          const split = ubsSplitDetails();
          Object.assign(linked, {accountId:split.from.id,toAccountId:split.to.id,amount:split.amount.toFixed(2),chfAmount:split.amount.toFixed(2),date:entry.date,memo:`Shared ${entry.title} · ${split.percentage}%`,changedSinceExport:Boolean(linked.exportedAt)});
        }
        if (prior) state.entries = state.entries.map((item) => item.id === entry.id ? entry : item); else state.entries.push(entry);
        let generatedTransfer = null;
        if (!prior && ubsSplitChoice === true) {
          const split = ubsSplitDetails();
          generatedTransfer = { id:uid(), createdAt:new Date().toISOString(), exportedAt:null, type:"transfer", spendingClass:null, title:"Transfer", date:entry.date, memo:`Shared ${entry.title} · ${split.percentage}%`, accountId:split.from.id, toAccountId:split.to.id, amount:split.amount.toFixed(2), currency:"CHF", accountCurrency:"CHF", fxRate:null, fxDate:entry.date, fxSource:"not-applicable", chfAmount:split.amount.toFixed(2), generatedFrom:entry.id };
          state.entries.push(generatedTransfer);
        }
        if (!state.config.categories.includes(entry.title) && type !== "transfer") state.config.categories.push(entry.title);
        $("saved-copy").textContent = generatedTransfer ? `Saved the expense and a ${money(generatedTransfer.amount, "CHF")} reimbursement transfer.` : entry.currency === "EUR" && entry.type !== "transfer" && !entry.chfAmount ? "Saved on this device. Add a CHF value when you are ready to export." : "Saved on this device and ready for CSV export.";
        persist(); renderSettings(); renderEntries(); transactionCurrency = null; manualFx = false; ubsSplitChoice = null; quickPreset = null; editingId = null; type = null; spendingClass = null; fxSource = "manual"; customCategoryMode = false; $("capture-form").reset(); $("date").value = today(); $("fx-date").value = today(); $("fx-rate").value = ""; renderOptions(); currentStep = "done"; updateTypeUI(); setStatus("");
      }
      function savePreset(entry) {
        const generatedTransfer = state.entries.find((item) => item.generatedFrom === entry.id);
        const preset = { id:uid(), type:entry.type, spendingClass:entry.spendingClass, title:entry.title, nickname:"", memo:entry.memo, accountId:entry.accountId, toAccountId:entry.toAccountId, amount:entry.amount, currency:entry.currency, accountCurrency:entry.accountCurrency || account(entry.accountId)?.currency, ubsSplit:Boolean(generatedTransfer) };
        state.presets = [...(state.presets || []), preset]; persist(); renderPresets(); renderManagedPresets(); setStatus(`${preset.title || "Transfer"} added to Quick transactions.`, "good");
      }
      function applyPreset(preset) {
        if (!preset) return setStatus("That quick transaction is no longer available.", "error");
        cancelAdvance();
        resetForm(); quickOpen = false; quickPreset = preset; type = preset.type; spendingClass = preset.spendingClass; transactionCurrency = preset.currency; ubsSplitChoice = preset.ubsSplit;
        $("title").value = preset.title || ""; $("memo").value = preset.memo || ""; $("account").value = preset.accountId; $("to-account").value = preset.toAccountId || ""; $("date").value = today(); $("quick-amount").value = preset.amount; $("amount").value = preset.amount;
        currentStep = "quick-amount"; renderChoiceButtons(); updateFxUI(); updateStepUI();
      }
      function deletePreset(id) { state.presets = (state.presets || []).filter((preset) => preset.id !== id); persist(); renderPresets(); renderManagedPresets(); }
      function renamePreset(id, nickname) {
        const preset = (state.presets || []).find((item) => item.id === id);
        if (!preset) return;
        preset.nickname = nickname.trim(); persist(); renderPresets();
        setStatus(`${preset.title || "Transfer"} nickname saved.`, "good");
      }
      function deleteManagedPreset(id) {
        const preset = (state.presets || []).find((item) => item.id === id);
        if (!preset || !confirm(`Remove ${presetLabel(preset)} from Quick transactions?`)) return;
        deletePreset(id); setStatus(`${presetLabel(preset)} removed from Quick transactions.`, "good");
      }
      function toggleQuickPresets() { cancelAdvance(); quickOpen = true; quickPreset = null; currentStep = "quick-list"; renderPresets(); updateStepUI(); }
      async function fetchFx() {
        if (!needsFx()) { setStatus("A rate is required only when EUR is involved.", "error"); return; }
        const request = ++fxGeneration;
        const targetDate = $("date").value || today();
        const start = new Date(`${targetDate}T12:00:00`); start.setDate(start.getDate() - 10);
        const url = `https://api.frankfurter.dev/v2/rates?base=EUR&quotes=CHF&from=${start.toISOString().slice(0, 10)}&to=${targetDate}`;
        $("fetch-fx").disabled = true; $("fx-status").textContent = "Fetching the newest available EUR → CHF rate…";
        try {
          const response = await fetch(url, { headers: { Accept:"application/json" } });
          if (!response.ok) throw new Error(`Rate service returned ${response.status}`);
          const data = await response.json();
          if (request !== fxGeneration) return;
          if (!Array.isArray(data) || !data.length) throw new Error("No rate was returned for this date");
          const latest = data.sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
          const rate = number(latest.rate);
          if (!(rate > 0) || !CaptureCore.validDate(latest.date) || latest.date > targetDate || latest.base !== "EUR" || latest.quote !== "CHF") throw new Error("Unexpected rate data");
          $("fx-rate").value = rate.toString(); $("fx-date").value = latest.date; fxSource = "Frankfurter"; calculateChf();
          $("fx-status").textContent = `Frankfurter: 1 EUR = ${rate} CHF on ${latest.date}. You can edit this before saving.`;
        } catch (error) { if (request !== fxGeneration) return; $("fx-status").textContent = `Could not fetch a rate: ${error instanceof Error ? error.message : "unknown error"}. Enter it manually instead.`; }
        finally { $("fetch-fx").disabled = false; }
      }
      const csvCell = CaptureCore.csvCell;
      function splitRows(entry) { return CaptureCore.splitRows(entry, state.config); }
      function exportCsv() {
        const pending = state.entries.filter((entry) => !entry.exportedAt);
        if (!pending.length) return setStatus("There are no unexported drafts to download.", "error");
        const header = ["Transaction ID", "Date", "Description", "Notes", "Commodity/Currency", "Memo", "Account", "Deposit", "Price", "Value"];
        let rows;
        try { rows = pending.flatMap(splitRows); } catch (error) { return setStatus(error.message, "error"); }
        const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
        const blob = new Blob([csv], { type:"text/csv;charset=utf-8" }); const link = document.createElement("a");
        link.href = URL.createObjectURL(blob); link.download = `gnucash-mobile-${today()}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 30000);
        const exportedAt = new Date().toISOString(); state.entries = state.entries.map((entry) => pending.some((item) => item.id === entry.id) ? { ...entry, exportedAt } : entry); persist(); renderEntries(); setStatus(`Download requested for ${pending.length} transaction${pending.length === 1 ? "" : "s"} as CSV. Confirm the file was saved, review it in GnuCash, then mark each draft imported.`, "good");
      }
      function markUnexported(id) {
        const entry = state.entries.find((item) => item.id === id);
        if (!entry?.exportedAt) return;
        if (!confirm("Include this draft in another download? Check whether the earlier version was imported and remove or correct that version in GnuCash first to avoid duplicates.")) return;
        state.entries = state.entries.map((item) => item.id === id ? { ...item, exportedAt:null, importedAt:null, changedSinceExport:false } : item);
        persist(); renderEntries(); setStatus(`${entry.title || "Transaction"} will be included in the next CSV export.`, "good");
      }
      function saveSettings() {
        const nicoShare = number($("nico-share").value), gioShare = number($("gio-share").value);
        if (!(nicoShare > 0) || !(gioShare > 0) || Math.abs(nicoShare + gioShare - 100) > 0.000001) return setStatus("Nico and Gio shares must be positive and total 100%.", "error");
        for (const item of state.config.accounts) {
          const proposed = document.querySelector(`[data-setting-currency="${item.id}"]`).value;
          if (proposed !== item.currency && [...state.entries,...state.presets].some(e=>e.accountId===item.id || e.toAccountId===item.id)) return setStatus("Remove or finish drafts and shortcuts using this account before changing its currency.","error");
        }
        state.config.accounts.forEach((item) => { item.label = document.querySelector(`[data-setting-label="${item.id}"]`).value.trim() || item.label; item.path = document.querySelector(`[data-setting-path="${item.id}"]`).value.trim() || item.path; item.currency = document.querySelector(`[data-setting-currency="${item.id}"]`).value; });
        state.config.necessaryPath = $("necessary-path").value.trim() || defaults.necessaryPath; state.config.leisurePath = $("leisure-path").value.trim() || defaults.leisurePath;
        state.config.nicoSharePercent = nicoShare; state.config.gioSharePercent = gioShare;
        state.config.categories = $("categories").value.split(",").map((value) => value.trim()).filter(Boolean);
        persist(); renderOptions(); renderSettings(); renderEntries(); updateFxUI(); setStatus("Settings saved locally.", "good");
      }
      function backupData() {
        const payload = { format:"gnucash-mobile-companion-backup", version:1, exportedAt:new Date().toISOString(), data:state };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" }); const link = document.createElement("a");
        link.href = URL.createObjectURL(blob); link.download = `gnucash-mobile-backup-${today()}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 30000);
        $("backup-status").textContent = "Backup downloaded. Keep it somewhere you control.";
      }
      function restoreData(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const payload = JSON.parse(String(reader.result)); const restored = payload?.data;
            if (payload?.format !== "gnucash-mobile-companion-backup" || payload?.version !== 1 || !restored || !Array.isArray(restored.entries) || !restored.config || !Array.isArray(restored.config.accounts)) throw new Error("That is not a valid mobile companion backup.");
            const validated = CaptureCore.validateState(restored, defaults);
            if (!confirm(`Replace this device's ${state.entries.length} current draft${state.entries.length === 1 ? "" : "s"} with ${restored.entries.length} restored draft${restored.entries.length === 1 ? "" : "s"}?`)) return;
            state = validated; persist(true); resetForm(); renderSettings(); renderEntries(); $("backup-status").textContent = `Restored ${state.entries.length} draft${state.entries.length === 1 ? "" : "s"} from backup.`;
          } catch (error) { $("backup-status").textContent = error instanceof Error ? error.message : "Could not restore that backup."; }
          $("restore-file").value = "";
        };
        reader.onerror = () => { $("backup-status").textContent = "Could not read this backup. Existing data is unchanged."; $("restore-file").value = ""; };
        reader.readAsText(file);
      }
      function markImported(id) {
        const entry = state.entries.find(item=>item.id===id);
        if (!entry?.exportedAt || entry.changedSinceExport) return;
        if (!confirm("Have you successfully imported this exact downloaded draft into GnuCash?")) return;
        entry.importedAt = new Date().toISOString(); persist(); renderEntries();
      }
      function deleteEntry(id) {
        const entry = state.entries.find(item=>item.id===id); if(!entry) return;
        const children = state.entries.filter(item=>item.generatedFrom===id);
        if (!confirm(children.length ? "Delete this expense AND its linked reimbursement? Previously imported transactions remain in GnuCash." : "Delete this draft? Previously imported transactions remain in GnuCash.")) return;
        state.entries = state.entries.filter(item=>item.id!==id && item.generatedFrom!==id); persist(); renderEntries(); if(editingId===id) resetForm();
      }
      function clearImported() {
        const removable = new Set(state.entries.filter(item=>item.importedAt && !item.changedSinceExport).map(item=>item.id));
        // Retain parents until their linked reimbursements can also be cleared.
        for (const item of state.entries) if(item.generatedFrom && !removable.has(item.id)) removable.delete(item.generatedFrom);
        if(!removable.size) return setStatus("No imported drafts can be cleared yet. Confirm linked reimbursements first.","error");
        if(!confirm(`Clear ${removable.size} confirmed imported drafts?`)) return;
        state.entries=state.entries.filter(item=>!removable.has(item.id)); persist(); renderEntries();
      }
      document.querySelectorAll("[data-type]").forEach((button) => button.addEventListener("click", () => { type = button.dataset.type; updateTypeUI(); advanceAfterChoice(); }));
      document.querySelectorAll("[data-class]").forEach((button) => button.addEventListener("click", () => { spendingClass = button.dataset.class; updateTypeUI(); advanceAfterChoice(); }));
      document.querySelectorAll("[data-next]").forEach((button) => button.addEventListener("click", () => moveStep(1)));
      document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => moveStep(-1)));
      $("category-choices").addEventListener("click", (event) => { const button = event.target.closest("[data-category]"); if (!button) return; if (button.dataset.category === "other") { cancelAdvance(); customCategoryMode = true; $("title").value = ""; renderChoiceButtons(); $("title").focus(); } else { customCategoryMode = false; $("title").value = button.dataset.category; renderChoiceButtons(); advanceAfterChoice(); } });
      $("add-category").addEventListener("click", () => { const title = $("title").value.trim(); if (!title) return setStatus("Enter a category name first.", "error"); if (!state.config.categories.includes(title)) state.config.categories.push(title); customCategoryMode = false; persist(); renderOptions(); renderSettings(); setStatus(""); advanceAfterChoice(); });
      $("account-choices").addEventListener("click", (event) => { const button = event.target.closest("[data-account-choice]"); if (!button) return; if ($("account").value !== button.dataset.accountChoice) { clearCurrencyChoice(); ubsSplitChoice = null; } $("account").value = button.dataset.accountChoice; renderChoiceButtons(); updateFxUI(); advanceAfterChoice(); });
      $("to-account-choices").addEventListener("click", (event) => { const button = event.target.closest("[data-to-account-choice]"); if (!button) return; $("to-account").value = button.dataset.toAccountChoice; renderChoiceButtons(); updateFxUI(); advanceAfterChoice(); });
      $("capture-form").addEventListener("submit", validateAndSave); $("account").addEventListener("change", updateFxUI); $("to-account").addEventListener("change", updateFxUI); $("amount").addEventListener("input", calculateChf); $("fx-rate").addEventListener("input", () => { fxSource = "manual"; calculateChf(); }); $("date").addEventListener("change", () => { if (!$("fx-date").value) $("fx-date").value = $("date").value; });
      $("quick-amount").addEventListener("input", () => { $("amount").value = $("quick-amount").value; calculateChf(); });
      document.querySelectorAll("[data-currency]").forEach((button) => button.addEventListener("click", () => {
        if (transactionCurrency !== button.dataset.currency) { $("fx-rate").value = ""; $("chf-amount").value = ""; manualFx = false; fxSource = "manual"; }
        transactionCurrency = button.dataset.currency; updateCurrencyChoices(); updateFxUI(); advanceAfterChoice();
      }));
      $("add-export-fx").addEventListener("click", () => { manualFx = true; currentStep = "fx"; updateFxUI(); updateStepUI(); });
      document.querySelectorAll("[data-ubs-split]").forEach((button) => button.addEventListener("click", () => {
        ubsSplitChoice = button.dataset.ubsSplit === "yes";
        document.querySelectorAll("[data-ubs-split]").forEach((choice) => { const selected = choice === button; choice.classList.toggle("selected", selected); choice.setAttribute("aria-pressed", String(selected)); });
        cancelAdvance();
        advanceTimer = setTimeout(() => { advanceTimer = null; validateAndSave({ preventDefault() {} }); }, 500);
      }));
      $("fetch-fx").addEventListener("click", fetchFx); $("export-csv").addEventListener("click", exportCsv); $("save-settings").addEventListener("click", saveSettings);
      $("new-entry").addEventListener("click", resetForm);
      $("backup-data").addEventListener("click", backupData); $("restore-data").addEventListener("click", () => $("restore-file").click()); $("restore-file").addEventListener("change", (event) => restoreData(event.target.files?.[0]));
      $("clear-exported").addEventListener("click", clearImported);
      $("draft-search").addEventListener("input", renderEntries);
      $("draft-group-by").addEventListener("change", renderEntries);
      $("entries").addEventListener("click", event => {
        for (const [attribute, action] of [["edit", id=>loadEntry(state.entries.find(item=>item.id===id))],["save-preset",id=>savePreset(state.entries.find(item=>item.id===id))],["unexport",markUnexported],["imported",markImported],["delete",deleteEntry]]) {
          const button=event.target.closest(`[data-${attribute}]`); if(button) action(button.getAttribute(`data-${attribute}`));
        }
      });
      $("quick-presets").addEventListener("click", (event) => { const use = event.target.closest("[data-preset]"); if (use) applyPreset((state.presets || []).find((preset) => preset.id === use.dataset.preset)); });
      $("quick-toggle").addEventListener("click", toggleQuickPresets);
      $("cancel-quick").addEventListener("click", resetForm);
      $("manage-quick").addEventListener("click", () => { $("settings-home").classList.add("hidden"); $("quick-management").classList.remove("hidden"); renderManagedPresets(); window.scrollTo({ top:0, behavior:"smooth" }); });
      $("close-quick-management").addEventListener("click", () => { $("quick-management").classList.add("hidden"); $("settings-home").classList.remove("hidden"); window.scrollTo({ top:0, behavior:"smooth" }); });
      $("managed-quick-presets").addEventListener("change", (event) => { const input = event.target.closest("[data-preset-nickname]"); if (input) renamePreset(input.dataset.presetNickname, input.value); });
      $("managed-quick-presets").addEventListener("click", (event) => { const button = event.target.closest("[data-delete-managed-preset]"); if (button) deleteManagedPreset(button.dataset.deleteManagedPreset); });
      document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => {
        if (button.dataset.nav === "capture" && currentStep === "done") resetForm();
        showView(button.dataset.nav);
      }));
      document.querySelectorAll("[data-date-offset]").forEach((button) => button.addEventListener("click", () => { const date = new Date(); date.setDate(date.getDate() + Number(button.dataset.dateOffset)); $("date").value = dateString(date); updateDateChoices(); advanceAfterChoice(); }));
      $("date").addEventListener("focus", cancelAdvance);
      $("date").addEventListener("input", () => { cancelAdvance(); updateDateChoices(); });
      $("entries").addEventListener("click", (event) => { if (event.target.closest("[data-start-capture]")) showView("capture"); });
      // Enter advances the current step; only the review screen can save a draft.
      $("capture-form").addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target.tagName === "INPUT" && currentStep !== "note") { event.preventDefault(); if (currentStep === "category") $("add-category").click(); else moveStep(1); } });
      $("memo").addEventListener("input", renderReview);
      $("capture-form").addEventListener("input", invalidateFx);
      window.addEventListener("error", event => { if(event.error?.captureStorage) event.preventDefault(); });
      renderOptions(); renderSettings(); renderEntries(); resetForm();
      if(store.problem) storageNotice(store.problem);
    })();
