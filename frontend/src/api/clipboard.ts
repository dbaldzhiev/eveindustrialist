
export function copyToClipboard(text: string, onSuccess?: () => void) {
  // Try modern API first
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      if (onSuccess) onSuccess();
    }).catch(err => {
      console.error("Modern clipboard API failed: ", err);
      fallbackCopyTextToClipboard(text, onSuccess);
    });
  } else {
    fallbackCopyTextToClipboard(text, onSuccess);
  }
}

function fallbackCopyTextToClipboard(text: string, onSuccess?: () => void) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  
  // Ensure the textarea is not visible but part of the DOM
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand("copy");
    if (successful && onSuccess) {
      onSuccess();
    } else if (!successful) {
      console.error("Fallback copy failed");
    }
  } catch (err) {
    console.error("Fallback copy exception: ", err);
  }

  document.body.removeChild(textArea);
}
