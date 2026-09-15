(function () {
  const { escapeHtml, showToast, post } = window.Zhihu;
  const urlInput = document.getElementById("url");
  const loading = document.getElementById("loading");
  const result = document.getElementById("result");
  const btn = document.getElementById("btn-decode");

  function decode() {
    const url = urlInput.value.trim();
    if (!url) {
      showToast("请输入盐选链接");
      return;
    }
    result.innerHTML = "";
    post("decode", { url });
  }

  btn.addEventListener("click", decode);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") decode();
  });

  window.addEventListener("message", (e) => {
    const msg = e.data || {};
    if (msg.type === "decodeLoading") {
      loading.classList.toggle("hidden", !msg.loading);
      window.Zhihu.setBusy(btn, !!msg.loading);
    } else if (msg.type === "decodeResult") {
      render(msg.data || {});
    } else if (msg.type === "error") {
      loading.classList.add("hidden");
      window.Zhihu.setBusy(btn, false);
      showToast(msg.message || "解码失败");
    }
  });

  function render(data) {
    const warnings = (data.warnings || [])
      .map((w) => '<div class="error">' + escapeHtml(w) + "</div>")
      .join("");
    result.innerHTML =
      '<div class="decode-title">' +
      escapeHtml(data.title || "解码结果") +
      "</div>" +
      warnings +
      '<div class="decode-text">' +
      escapeHtml(data.text || "") +
      '</div><div class="decode-meta">字数 ' +
      escapeHtml(String(data.text_length ?? 0)) +
      " · 字体映射 " +
      escapeHtml(String(data.mapping_size ?? 0)) +
      "</div>";
  }
})();
