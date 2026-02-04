import { useState, useRef, useEffect, useImperativeHandle, memo, useCallback } from 'react';
import { useVoiceToText } from '../hooks/useVoiceToText';

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
  const [voiceAutoSubmit, setVoiceAutoSubmit] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const [voiceInputWasEmpty, setVoiceInputWasEmpty] = useState(false);
  const textareaRef = useRef(null);

  // Voice-to-text hook
  const {
    isRecording,
    isConnecting,
    startRecording,
    stopRecording,
    transcript,
  } = useVoiceToText({
    onTranscript: useCallback((text) => {
      // Update input with transcribed text
      setInput(text);
      if (onInputChange) {
        onInputChange(text);
      }
    }, [onInputChange]),
    onFinalTranscript: useCallback((text) => {
      // If input was empty when recording started, auto-submit
      // Note: voiceInputWasEmpty is captured in closure when recording starts
      if (text.trim()) {
        setVoiceAutoSubmit(true);
      }
    }, []),
    onError: useCallback((error) => {
      setVoiceError(error);
      // Clear error after 3 seconds
      setTimeout(() => setVoiceError(null), 3000);
    }, []),
  });

  // Handle auto-submit after voice recording
  useEffect(() => {
    if (voiceAutoSubmit && voiceInputWasEmpty && input.trim() && !isRecording && !isConnecting) {
      setVoiceAutoSubmit(false);
      setVoiceInputWasEmpty(false);
      // Small delay to ensure UI updates
      const timer = setTimeout(() => {
        onSubmit(input);
        setInput('');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [voiceAutoSubmit, voiceInputWasEmpty, input, isRecording, isConnecting, onSubmit]);

  // Voice button handlers
  const handleVoiceMouseDown = useCallback((e) => {
    e.preventDefault();
    if (isRecording || isConnecting || !isConnected || isResponsePending) return;

    // Remember if input was empty when starting
    const wasEmpty = !input.trim();
    setVoiceInputWasEmpty(wasEmpty);
    startRecording();
  }, [isRecording, isConnecting, isConnected, isResponsePending, input, startRecording]);

  const handleVoiceMouseUp = useCallback((e) => {
    e.preventDefault();
    if (!isRecording && !isConnecting) return;
    stopRecording();
  }, [isRecording, isConnecting, stopRecording]);

  // Also handle mouse leave to stop recording if user drags away
  const handleVoiceMouseLeave = useCallback((e) => {
    if (isRecording) {
      stopRecording();
    }
  }, [isRecording, stopRecording]);

  // Keyboard shortcut for voice (Ctrl+Shift+V or Cmd+Shift+V)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        if (!isRecording && !isConnecting && isConnected && !isResponsePending) {
          const wasEmpty = !input.trim();
          setVoiceInputWasEmpty(wasEmpty);
          startRecording();
        }
      }
    };

    const handleKeyUp = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        if (isRecording) {
          stopRecording();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isRecording, isConnecting, isConnected, isResponsePending, input, startRecording, stopRecording]);

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
          placeholder={
            isRecording
              ? "Listening..."
              : isConnecting
              ? "Connecting..."
              : isResponsePending
              ? "Waiting for response..."
              : "Type a message... (Shift + Enter for new line)"
          }
          disabled={!isConnected || isResponsePending}
          readOnly={isRecording && voiceInputWasEmpty}
          rows={3}
        />
        {voiceError && (
          <div className="voice-error">{voiceError}</div>
        )}
      </div>
      <div className="button-stack">
        <button
          type="button"
          className={`voice-button ${isRecording ? 'recording' : ''} ${isConnecting ? 'connecting' : ''}`}
          onMouseDown={handleVoiceMouseDown}
          onMouseUp={handleVoiceMouseUp}
          onMouseLeave={handleVoiceMouseLeave}
          onTouchStart={handleVoiceMouseDown}
          onTouchEnd={handleVoiceMouseUp}
          disabled={!isConnected || isResponsePending}
          title="Hold to talk (Ctrl+Shift+V)"
        >
          {isConnecting ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="32">
                <animate attributeName="stroke-dashoffset" dur="1s" repeatCount="indefinite" values="32;0" />
              </circle>
            </svg>
          ) : isRecording ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="6">
                <animate attributeName="r" dur="0.8s" repeatCount="indefinite" values="6;8;6" />
              </circle>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>
        <button type="submit" disabled={!isConnected || isResponsePending || (!input.trim() && attachments.length === 0)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
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
