import { useState, useRef, useEffect, useImperativeHandle, memo } from 'react';

/**
 * ChatInput component - manages local input state to prevent parent re-renders.
 * Attachments and other state remain in parent.
 * React 19: ref is now a regular prop, no forwardRef needed.
 */
export const ChatInput = memo(function ChatInput({
  onSubmit,
  onInputChange,
  onKeyDown: parentKeyDown,
  onPaste,
  attachments,
  onRemoveAttachment,
  isConnected,
  isResponsePending,
  reasoningMode,
  messageType,
  onReasoningModeChange,
  onMessageTypeChange,
  modelCapabilities,
  ref,
}) {
  const [input, setInput] = useState('');
  const [hashtagMenuOpen, setHashtagMenuOpen] = useState(false);
  const [hashtagMenuPosition, setHashtagMenuPosition] = useState({ top: 0, left: 0 });
  const [hashtagMenuIndex, setHashtagMenuIndex] = useState(0);
  const textareaRef = useRef(null);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    clear: () => setInput(''),
    focus: () => textareaRef.current?.focus(),
    getValue: () => input,
  }));

  // Build hashtag menu options from model capabilities
  const hashtagMenuOptions = [];
  if (modelCapabilities && modelCapabilities.reasoningEfforts) {
    for (let i = 0; i < modelCapabilities.reasoningEfforts.length; i++) {
      const effort = modelCapabilities.reasoningEfforts[i];
      if (effort === 'high') {
        hashtagMenuOptions.push({
          id: 'high',
          type: 'reasoning',
          label: 'Think',
          icon: '🧠',
          desc: 'Extended thinking mode',
        });
      } else if (effort === 'xhigh') {
        hashtagMenuOptions.push({
          id: 'xhigh',
          type: 'reasoning',
          label: 'Think+',
          icon: '🧠',
          desc: 'Maximum thinking depth',
        });
      }
    }
  }
  hashtagMenuOptions.push({
    id: 'deep_research',
    type: 'message_type',
    label: 'Deep Research',
    icon: '🔬',
    desc: 'Multi-agent research',
  });

  const handleLocalInputChange = (e) => {
    const newValue = e.target.value;
    setInput(newValue);

    // Notify parent if needed
    if (onInputChange) {
      onInputChange(newValue);
    }

    // Check for # trigger for hashtag menu
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const lastHashIndex = textBeforeCursor.lastIndexOf('#');

    if (lastHashIndex !== -1) {
      const textAfterHash = textBeforeCursor.slice(lastHashIndex + 1);
      const charBeforeHash = lastHashIndex > 0 ? textBeforeCursor[lastHashIndex - 1] : ' ';
      if ((charBeforeHash === ' ' || charBeforeHash === '\n' || lastHashIndex === 0) && !textAfterHash.includes(' ')) {
        // Calculate position relative to viewport for fixed positioning
        // CSS has translateY(-100%) so we just need to position at textarea top
        const textarea = textareaRef.current;
        if (textarea) {
          const rect = textarea.getBoundingClientRect();
          setHashtagMenuPosition({
            top: rect.top - 8, // Small gap above textarea, CSS translateY(-100%) handles the rest
            left: rect.left,
          });
        }
        setHashtagMenuOpen(true);
        setHashtagMenuIndex(0);
        return;
      }
    }
    setHashtagMenuOpen(false);
  };

  const handleHashtagMenuSelect = (option) => {
    // Remove the # and text after it from input
    const cursorPos = textareaRef.current ? textareaRef.current.selectionStart : input.length;
    const textBeforeCursor = input.slice(0, cursorPos);
    const lastHashIndex = textBeforeCursor.lastIndexOf('#');
    if (lastHashIndex !== -1) {
      const newInput = input.slice(0, lastHashIndex) + input.slice(cursorPos);
      setInput(newInput);
    }

    // Only one think mode at a time (reasoning OR deep research, not both)
    if (option.type === 'message_type') {
      onReasoningModeChange(null); // Clear reasoning mode
      onMessageTypeChange(option.id);
    } else if (option.type === 'reasoning') {
      onMessageTypeChange(null); // Clear message type (deep research)
      onReasoningModeChange(option.id);
    }

    setHashtagMenuOpen(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleLocalKeyDown = (e) => {
    // Handle hashtag menu navigation
    if (hashtagMenuOpen && hashtagMenuOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHashtagMenuIndex((prev) => (prev + 1) % hashtagMenuOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHashtagMenuIndex((prev) => (prev - 1 + hashtagMenuOptions.length) % hashtagMenuOptions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleHashtagMenuSelect(hashtagMenuOptions[hashtagMenuIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setHashtagMenuOpen(false);
        return;
      }
    }

    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() || attachments.length > 0) {
        handleLocalSubmit(e);
      }
      return;
    }

    // Pass other key events to parent
    if (parentKeyDown) {
      parentKeyDown(e);
    }
  };

  const handleLocalSubmit = (e) => {
    if (e) e.preventDefault();
    if (!input.trim() && attachments.length === 0) return;
    if (!isConnected || isResponsePending) return;

    onSubmit(input);
    setInput('');
    setHashtagMenuOpen(false);
  };

  return (
    <form className="input-form" onSubmit={handleLocalSubmit}>
      <div className="input-wrapper">
        {/* Chips bar - show if attachments OR reasoning mode OR message type */}
        {(attachments.length > 0 || reasoningMode || messageType) && (
          <div className="attachments-bar">
            {/* Attachment chips first */}
            {attachments.map((attachment, index) => (
              <div key={index} className="attachment-chip">
                <span className="attachment-icon">
                  {attachment.type.startsWith('image/') ? '🖼️' : '📎'}
                </span>
                <span className="attachment-name">{attachment.name}</span>
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => onRemoveAttachment(index)}
                >
                  ×
                </button>
              </div>
            ))}

            {/* Message type chip (e.g., Deep Research) */}
            {messageType && (
              <div className="hashtag-chip hashtag-chip-research">
                <span className="hashtag-chip-icon">🔬</span>
                <span className="hashtag-chip-label">
                  {messageType === 'deep_research' ? 'Deep Research' : messageType}
                </span>
                <button
                  type="button"
                  className="hashtag-chip-remove"
                  onClick={() => onMessageTypeChange(null)}
                  title="Remove message type"
                >
                  ×
                </button>
              </div>
            )}

            {/* Reasoning mode chip, accent color */}
            {reasoningMode && (
              <div className="hashtag-chip">
                <span className="hashtag-chip-icon">🧠</span>
                <span className="hashtag-chip-label">
                  {reasoningMode === 'xhigh' ? 'Think+' : 'Think'}
                </span>
                <button
                  type="button"
                  className="hashtag-chip-remove"
                  onClick={() => onReasoningModeChange(null)}
                  title="Remove reasoning mode"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        {/* Hashtag context menu */}
        {hashtagMenuOpen && hashtagMenuOptions.length > 0 && (
          <div
            className="hashtag-menu"
            style={{ top: hashtagMenuPosition.top, left: hashtagMenuPosition.left }}
          >
            {hashtagMenuOptions.map((option, index) => (
              <button
                key={option.id}
                type="button"
                className={`hashtag-menu-item ${hashtagMenuIndex === index ? 'selected' : ''}`}
                onClick={() => handleHashtagMenuSelect(option)}
                onMouseEnter={() => setHashtagMenuIndex(index)}
              >
                <span>{option.icon} {option.label}</span>
                <span className="hashtag-menu-item-desc">{option.desc}</span>
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleLocalInputChange}
          onKeyDown={handleLocalKeyDown}
          onPaste={onPaste}
          placeholder={isResponsePending ? "Waiting for response..." : "Type a message... (Shift + Enter for new line)"}
          disabled={!isConnected || isResponsePending}
          rows={3}
        />
      </div>
      <button type="submit" disabled={!isConnected || isResponsePending || (!input.trim() && attachments.length === 0)}>
        {isResponsePending ? 'Waiting...' : 'Send'}
      </button>
    </form>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render when these value props change
  // Callbacks are not compared since they may have new references but same behavior
  return (
    prevProps.attachments === nextProps.attachments &&
    prevProps.isConnected === nextProps.isConnected &&
    prevProps.isResponsePending === nextProps.isResponsePending &&
    prevProps.reasoningMode === nextProps.reasoningMode &&
    prevProps.messageType === nextProps.messageType &&
    prevProps.modelCapabilities === nextProps.modelCapabilities
  );
});
