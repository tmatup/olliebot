import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { useWebSocket } from './hooks/useWebSocket';
import HtmlPreview from './components/HtmlPreview';

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [pendingInteraction, setPendingInteraction] = useState(null);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);

  // Accordion states
  const [expandedAccordions, setExpandedAccordions] = useState({
    tasks: false,
    skills: false,
    mcps: false,
    tools: false,
  });
  const [agentTasks, setAgentTasks] = useState([]);
  const [skills, setSkills] = useState([]);
  const [mcps, setMcps] = useState([]);
  const [tools, setTools] = useState({ builtin: [], user: [], mcp: {} });
  const [expandedToolGroups, setExpandedToolGroups] = useState({});

  // Actions menu state
  const [openMenuId, setOpenMenuId] = useState(null);

  // Auto-scroll state
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Expanded tool events
  const [expandedTools, setExpandedTools] = useState(new Set());

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  const handleMessage = useCallback((data) => {
    if (data.type === 'message') {
      const messageId = data.id || `msg-${Date.now()}`;
      setMessages((prev) => {
        // Deduplicate by ID
        if (prev.some((m) => m.id === messageId)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: messageId,
            role: 'assistant',
            content: data.content,
            timestamp: data.timestamp,
            buttons: data.buttons,
            html: data.html,
            agentName: data.agentName,
            agentEmoji: data.agentEmoji,
          },
        ];
      });
    } else if (data.type === 'stream_start') {
      // Start a new streaming message
      setMessages((prev) => [
        ...prev,
        {
          id: data.id,
          role: 'assistant',
          content: '',
          timestamp: data.timestamp,
          isStreaming: true,
          agentName: data.agentName,
          agentEmoji: data.agentEmoji,
        },
      ]);
    } else if (data.type === 'stream_chunk') {
      // Append chunk to streaming message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.streamId
            ? { ...m, content: m.content + data.chunk }
            : m
        )
      );
    } else if (data.type === 'stream_end') {
      // Mark streaming as complete
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.streamId
            ? { ...m, isStreaming: false }
            : m
        )
      );
    } else if (data.type === 'error') {
      const errorId = data.id || `err-${Date.now()}`;
      setMessages((prev) => {
        // Deduplicate by ID
        if (prev.some((m) => m.id === errorId)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: errorId,
            role: 'assistant',
            content: `**Error:** ${data.error}${data.details ? `\n\n\`\`\`\n${data.details}\n\`\`\`` : ''}`,
            timestamp: data.timestamp,
            isError: true,
          },
        ];
      });
    } else if (data.type === 'connected') {
      setIsConnected(true);
    } else if (data.type === 'interaction') {
      // A2UI interaction request
      setPendingInteraction(data.request);
    } else if (data.type === 'tool_requested') {
      // Tool invocation - show compact system message
      const toolId = `tool-${data.requestId}`;
      setMessages((prev) => {
        if (prev.some((m) => m.id === toolId)) return prev;
        return [
          ...prev,
          {
            id: toolId,
            role: 'tool',
            toolName: data.toolName,
            source: data.source,
            parameters: data.parameters,
            status: 'running',
            timestamp: data.timestamp,
          },
        ];
      });
    } else if (data.type === 'tool_execution_finished') {
      // Update tool message with result
      setMessages((prev) =>
        prev.map((m) =>
          m.id === `tool-${data.requestId}`
            ? {
                ...m,
                status: data.success ? 'completed' : 'failed',
                durationMs: data.durationMs,
                error: data.error,
                parameters: data.parameters,
                result: data.result,
              }
            : m
        )
      );
    } else if (data.type === 'delegation') {
      // Agent delegation event - show compact system message
      const delegationId = `delegation-${data.agentId}`;
      setMessages((prev) => {
        if (prev.some((m) => m.id === delegationId)) return prev;
        return [
          ...prev,
          {
            id: delegationId,
            role: 'delegation',
            agentName: data.agentName,
            agentEmoji: data.agentEmoji,
            agentType: data.agentType,
            mission: data.mission,
            timestamp: data.timestamp,
          },
        ];
      });
    } else if (data.type === 'task_run') {
      // Task run event - show compact task card
      const taskRunId = `task-run-${data.taskId}-${Date.now()}`;
      setMessages((prev) => {
        if (prev.some((m) => m.taskId === data.taskId && m.role === 'task_run')) return prev;
        return [
          ...prev,
          {
            id: taskRunId,
            role: 'task_run',
            taskId: data.taskId,
            taskName: data.taskName,
            taskDescription: data.taskDescription,
            timestamp: data.timestamp,
          },
        ];
      });
    } else if (data.type === 'conversation_created') {
      // New conversation was auto-created by backend
      const conv = data.conversation;
      setConversations((prev) => {
        // Don't add if already exists
        if (prev.some((c) => c.id === conv.id)) return prev;
        return [{
          id: conv.id,
          title: conv.title,
          updatedAt: conv.updatedAt,
        }, ...prev];
      });
      setCurrentConversationId(conv.id);
    } else if (data.type === 'conversation_updated') {
      // Conversation title or metadata was updated
      const { id, title, updatedAt } = data.conversation;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, title: title || c.title, updatedAt: updatedAt || c.updatedAt } : c
        )
      );
    }
  }, []);

  const handleOpen = useCallback(() => setIsConnected(true), []);
  const handleClose = useCallback(() => setIsConnected(false), []);

  const { sendMessage, connectionState } = useWebSocket({
    onMessage: handleMessage,
    onOpen: handleOpen,
    onClose: handleClose,
  });

  // Load history and conversations on mount (async, non-blocking)
  useEffect(() => {
    // Load current conversation messages
    fetch('/api/messages?limit=50')
      .then((res) => res.json())
      .then((data) => {
        setMessages(
          data.map((msg) => {
            // Determine the role based on message type
            let role = msg.role;
            if (msg.messageType === 'task_run') {
              role = 'task_run';
            } else if (msg.messageType === 'tool_event' || msg.role === 'tool') {
              role = 'tool';
            }

            return {
              id: msg.id,
              role,
              content: msg.content,
              timestamp: msg.createdAt,
              agentName: msg.agentName,
              agentEmoji: msg.agentEmoji,
              // Task metadata
              taskId: msg.taskId,
              taskName: msg.taskName,
              taskDescription: msg.taskDescription,
              // Tool event metadata
              toolName: msg.toolName,
              source: msg.toolSource,
              status: msg.toolSuccess === true ? 'completed' : msg.toolSuccess === false ? 'failed' : undefined,
              durationMs: msg.toolDurationMs,
              error: msg.toolError,
              parameters: msg.toolParameters,
              result: msg.toolResult,
            };
          })
        );
      })
      .catch(console.error);

    // Show skeleton after 500ms if still loading
    const skeletonTimer = setTimeout(() => {
      setShowSkeleton(true);
    }, 500);

    // Load conversation history asynchronously
    const loadConversations = async () => {
      try {
        const res = await fetch('/api/conversations');
        if (!res.ok) throw new Error('API not available');
        const data = await res.json();
        // Map API response to consistent format
        const mapped = data.map(c => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt || c.updated_at,
        }));
        setConversations(mapped);
        if (mapped.length > 0) {
          setCurrentConversationId(mapped[0].id);
        }
      } catch {
        // API might not exist yet, use empty state
        setConversations([]);
        setCurrentConversationId(null);
      } finally {
        clearTimeout(skeletonTimer);
        setConversationsLoading(false);
        setShowSkeleton(false);
      }
    };

    loadConversations();

    // Load agent tasks, skills, MCPs, and tools
    const loadSidebarData = async () => {
      try {
        const [tasksRes, skillsRes, mcpsRes, toolsRes] = await Promise.all([
          fetch('/api/tasks').catch(() => ({ ok: false })),
          fetch('/api/skills').catch(() => ({ ok: false })),
          fetch('/api/mcps').catch(() => ({ ok: false })),
          fetch('/api/tools').catch(() => ({ ok: false })),
        ]);

        if (tasksRes.ok) {
          const tasks = await tasksRes.json();
          setAgentTasks(tasks);
        }

        if (skillsRes.ok) {
          const skillsData = await skillsRes.json();
          setSkills(skillsData);
        }

        if (mcpsRes.ok) {
          const mcpsData = await mcpsRes.json();
          setMcps(mcpsData);
        }

        if (toolsRes.ok) {
          const toolsData = await toolsRes.json();
          setTools(toolsData);
        }
      } catch {
        // APIs might not be available
      }
    };

    loadSidebarData();

    return () => clearTimeout(skeletonTimer);
  }, []);

  // Smart auto-scroll - only scroll if user hasn't manually scrolled up
  useEffect(() => {
    if (!isUserScrolled && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isUserScrolled]);

  // Handle scroll events to detect manual scrolling
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    // If user scrolled more than 100px from bottom, consider it manual scroll
    if (distanceFromBottom > 100) {
      setIsUserScrolled(true);
      setShowScrollButton(true);
    } else {
      setIsUserScrolled(false);
      setShowScrollButton(false);
    }
  }, []);

  // Scroll to bottom handler
  const scrollToBottom = useCallback(() => {
    setIsUserScrolled(false);
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Start a new conversation
  const handleNewConversation = useCallback(async () => {
    try {
      // Create conversation on server
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      });

      if (res.ok) {
        const newConv = await res.json();
        setConversations((prev) => [{
          id: newConv.id,
          title: newConv.title,
          updatedAt: newConv.updatedAt || new Date().toISOString(),
        }, ...prev]);
        setCurrentConversationId(newConv.id);
      }

      // Tell server to start new conversation context
      sendMessage({ type: 'new-conversation' });

      // Clear local messages
      setMessages([]);
      setIsUserScrolled(false);
      setShowScrollButton(false);
    } catch (error) {
      console.error('Failed to create new conversation:', error);
      // Fallback to local-only
      const newId = `conv-${Date.now()}`;
      setConversations((prev) => [{
        id: newId,
        title: 'New Conversation',
        updatedAt: new Date().toISOString(),
      }, ...prev]);
      setCurrentConversationId(newId);
      setMessages([]);
    }
  }, [sendMessage]);

  // Delete conversation (soft delete)
  const handleDeleteConversation = useCallback(async (convId, e) => {
    e.stopPropagation(); // Prevent selecting the conversation
    setOpenMenuId(null);

    try {
      const res = await fetch(`/api/conversations/${convId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        // Remove from local state
        setConversations((prev) => prev.filter((c) => c.id !== convId));

        // If deleted conversation was current, switch to another or clear
        if (convId === currentConversationId) {
          const remaining = conversations.filter((c) => c.id !== convId);
          if (remaining.length > 0) {
            setCurrentConversationId(remaining[0].id);
            // Load messages for new current conversation
            const msgRes = await fetch(`/api/conversations/${remaining[0].id}/messages`);
            if (msgRes.ok) {
              const data = await msgRes.json();
              setMessages(
                data.map((msg) => {
                  let role = msg.role;
                  if (msg.messageType === 'task_run') {
                    role = 'task_run';
                  } else if (msg.messageType === 'tool_event' || msg.role === 'tool') {
                    role = 'tool';
                  }

                  return {
                    id: msg.id,
                    role,
                    content: msg.content,
                    timestamp: msg.createdAt || msg.created_at,
                    agentName: msg.agentName,
                    agentEmoji: msg.agentEmoji,
                    taskId: msg.taskId,
                    taskName: msg.taskName,
                    taskDescription: msg.taskDescription,
                    toolName: msg.toolName,
                    source: msg.toolSource,
                    status: msg.toolSuccess === true ? 'completed' : msg.toolSuccess === false ? 'failed' : undefined,
                    durationMs: msg.toolDurationMs,
                    error: msg.toolError,
                    parameters: msg.toolParameters,
                    result: msg.toolResult,
                  };
                })
              );
            }
          } else {
            setCurrentConversationId(null);
            setMessages([]);
          }
        }
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  }, [conversations, currentConversationId]);

  // Toggle actions menu
  const toggleActionsMenu = useCallback((convId, e) => {
    e.stopPropagation(); // Prevent selecting the conversation
    setOpenMenuId((prev) => (prev === convId ? null : convId));
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);

  // Switch conversation
  const handleSelectConversation = useCallback(async (convId) => {
    if (convId === currentConversationId) return;

    setCurrentConversationId(convId);
    setIsUserScrolled(false);
    setShowScrollButton(false);

    try {
      const res = await fetch(`/api/conversations/${convId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(
          data.map((msg) => {
            // Determine the role based on message type
            let role = msg.role;
            if (msg.messageType === 'task_run') {
              role = 'task_run';
            } else if (msg.messageType === 'tool_event' || msg.role === 'tool') {
              role = 'tool';
            }

            return {
              id: msg.id,
              role,
              content: msg.content,
              timestamp: msg.createdAt || msg.created_at,
              agentName: msg.agentName,
              agentEmoji: msg.agentEmoji,
              taskId: msg.taskId,
              taskName: msg.taskName,
              taskDescription: msg.taskDescription,
              // Tool event metadata
              toolName: msg.toolName,
              source: msg.toolSource,
              status: msg.toolSuccess === true ? 'completed' : msg.toolSuccess === false ? 'failed' : undefined,
              durationMs: msg.toolDurationMs,
              error: msg.toolError,
              parameters: msg.toolParameters,
              result: msg.toolResult,
            };
          })
        );
      } else {
        setMessages([]);
      }
    } catch {
      setMessages([]);
    }
  }, [currentConversationId]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Add user message to UI immediately
    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Send via WebSocket with conversation ID
    sendMessage({ type: 'message', content: input, conversationId: currentConversationId });
    setInput('');
  };

  const handleAction = (action, data) => {
    sendMessage({ type: 'action', action, data, conversationId: currentConversationId });
  };

  const handleInteractionResponse = (response) => {
    sendMessage({
      type: 'interaction-response',
      requestId: pendingInteraction.id,
      conversationId: currentConversationId,
      ...response,
    });
    setPendingInteraction(null);
  };

  // Run a task immediately
  const handleRunTask = useCallback(async (taskId) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: currentConversationId }),
      });

      if (res.ok) {
        // Update the task in local state to show it's running
        setAgentTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: 'running' } : t
          )
        );
      } else {
        console.error('Failed to run task');
      }
    } catch (error) {
      console.error('Error running task:', error);
    }
  }, [currentConversationId]);

  // Helper to check if a value is a data URL image
  const isDataUrlImage = (value) => {
    return typeof value === 'string' && value.startsWith('data:image/');
  };

  // Render tool result with special handling for images
  const renderToolResult = (result) => {
    if (!result) return null;

    // If result is a string, try to parse it as JSON first
    let parsedResult = result;
    if (typeof result === 'string') {
      // Check if it's a direct image data URL
      if (isDataUrlImage(result)) {
        return (
          <div className="tool-result-image">
            <img src={result} alt="Tool result" style={{ maxWidth: '100%', maxHeight: '400px' }} />
          </div>
        );
      }

      // Try to parse as JSON (result might be stringified, possibly double-stringified)
      let trimmed = result.trim();
      // Handle double-stringified JSON (starts with " and contains escaped quotes)
      if (trimmed.startsWith('"') && trimmed.includes('\\"')) {
        try {
          // First parse to unwrap the outer string
          const unwrapped = JSON.parse(trimmed);
          if (typeof unwrapped === 'string') {
            trimmed = unwrapped.trim();
          }
        } catch {
          // Continue with original
        }
      }

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          parsedResult = JSON.parse(trimmed);
        } catch {
          // Not valid JSON, keep as string
          return <pre className="tool-details-content">{result}</pre>;
        }
      } else {
        return <pre className="tool-details-content">{result}</pre>;
      }
    }

    // If parsedResult is an object, look for dataUrl properties
    if (typeof parsedResult === 'object' && parsedResult !== null) {
      const hasImageData = Object.entries(parsedResult).some(
        ([key, value]) => key === 'dataUrl' && isDataUrlImage(value)
      );

      if (hasImageData) {
        // Render with image preview
        return (
          <div className="tool-result-with-image">
            {Object.entries(parsedResult).map(([key, value]) => {
              if (key === 'dataUrl' && isDataUrlImage(value)) {
                return (
                  <div key={key} className="tool-result-image">
                    <div className="tool-result-image-label">{key}:</div>
                    <img src={value} alt="Result image" style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '4px' }} />
                  </div>
                );
              }
              // Render other properties as JSON
              return (
                <div key={key} className="tool-result-property">
                  <span className="tool-result-key">{key}:</span>{' '}
                  <span className="tool-result-value">
                    {typeof value === 'string' ? value : JSON.stringify(value)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      }
    }

    // Default: render as JSON
    return <pre className="tool-details-content">{JSON.stringify(parsedResult, null, 2)}</pre>;
  };

  // Render markdown with inline HTML support
  const renderContent = (content, html = false) => {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={html ? [rehypeRaw, rehypeSanitize] : [rehypeSanitize]}
        components={{
          // Custom rendering for pre (code blocks)
          pre({ children }) {
            return <div className="code-block-wrapper">{children}</div>;
          },
          // Custom rendering for code
          code({ node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : null;
            // If inside a pre tag (code block), render as block
            const isBlock = match || (node?.tagName === 'code' && node?.parent?.tagName === 'pre');

            if (isBlock) {
              // Check if this is HTML content - render with HtmlPreview
              if (language === 'html' || language === 'htm') {
                const htmlContent = String(children).replace(/\n$/, '');
                return <HtmlPreview html={htmlContent} />;
              }

              return (
                <pre className={`code-block ${match ? `language-${match[1]}` : ''}`}>
                  <code {...props}>{children}</code>
                </pre>
              );
            }
            // Inline code
            return (
              <code className="inline-code" {...props}>
                {children}
              </code>
            );
          },
          // Custom table rendering
          table({ children }) {
            return (
              <div className="table-wrapper">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  // Toggle accordion
  const toggleAccordion = useCallback((key) => {
    setExpandedAccordions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  // Format tool tooltip with description and inputs
  const formatToolTooltip = useCallback((tool) => {
    let tooltip = tool.description || tool.name;
    if (tool.inputs && tool.inputs.length > 0) {
      tooltip += '\n\nInputs:';
      for (const input of tool.inputs) {
        const req = input.required ? '(required)' : '(optional)';
        tooltip += `\n  • ${input.name}: ${input.type} ${req}`;
        if (input.description) {
          tooltip += `\n      ${input.description}`;
        }
      }
    }
    return tooltip;
  }, []);

  // Toggle tool event expansion
  const toggleToolExpand = useCallback((toolId) => {
    setExpandedTools((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(toolId)) {
        newSet.delete(toolId);
      } else {
        newSet.add(toolId);
      }
      return newSet;
    });
  }, []);

  // Format date for conversation list
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="app-layout">
      {/* Collapsible Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
        <div className="sidebar-header">
          <button
            className="new-conversation-btn"
            onClick={handleNewConversation}
            title="New Chat"
          >
            <span className="btn-icon">+</span>
            {sidebarOpen && <span>New Chat</span>}
          </button>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {sidebarOpen && (
          <>
          <div className="conversation-list">
            <div className="conversation-list-header">History</div>

            {/* Skeleton loading state */}
            {conversationsLoading && showSkeleton && (
              <>
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="conversation-item skeleton">
                    <div className="conversation-info">
                      <div className="skeleton-title" />
                      <div className="skeleton-date" />
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Loaded conversations */}
            {!conversationsLoading && conversations.map((conv) => (
              <div
                key={conv.id}
                className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''}`}
                onClick={() => handleSelectConversation(conv.id)}
              >
                <div className="conversation-info">
                  <div className="conversation-title">{conv.title}</div>
                  <div className="conversation-date">{formatDate(conv.updatedAt)}</div>
                </div>
                <div className="conversation-actions">
                  <button
                    className="actions-menu-btn"
                    onClick={(e) => toggleActionsMenu(conv.id, e)}
                    title="Actions"
                  >
                    ⋯
                  </button>
                  {openMenuId === conv.id && (
                    <div className="actions-menu">
                      <button
                        className="actions-menu-item delete"
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {!conversationsLoading && conversations.length === 0 && (
              <div className="no-conversations">No conversations yet</div>
            )}
          </div>

          {/* Accordions Section */}
          <div className="sidebar-accordions">
            {/* Agent Tasks Accordion */}
            <div className="accordion">
              <button
                className={`accordion-header ${expandedAccordions.tasks ? 'expanded' : ''}`}
                onClick={() => toggleAccordion('tasks')}
              >
                <span className="accordion-icon">📋</span>
                <span className="accordion-title">Agent Tasks</span>
                <span className="accordion-arrow">{expandedAccordions.tasks ? '▼' : '▶'}</span>
              </button>
              {expandedAccordions.tasks && (
                <div className="accordion-content">
                  {agentTasks.length === 0 ? (
                    <div className="accordion-empty">No active tasks</div>
                  ) : (
                    agentTasks.map((task) => (
                      <div key={task.id} className="accordion-item task-item">
                        <span className={`task-status ${task.status}`}>●</span>
                        <span className="task-name">{task.name}</span>
                        <button
                          className="task-run-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRunTask(task.id);
                          }}
                          title="Run now"
                        >
                          ▶
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Agent Skills Accordion */}
            <div className="accordion">
              <button
                className={`accordion-header ${expandedAccordions.skills ? 'expanded' : ''}`}
                onClick={() => toggleAccordion('skills')}
              >
                <span className="accordion-icon">⚡</span>
                <span className="accordion-title">Agent Skills</span>
                <span className="accordion-arrow">{expandedAccordions.skills ? '▼' : '▶'}</span>
              </button>
              {expandedAccordions.skills && (
                <div className="accordion-content">
                  {skills.length === 0 ? (
                    <div className="accordion-empty">No skills loaded</div>
                  ) : (
                    skills.map((skill) => (
                      <div key={skill.id} className="accordion-item" title={skill.description}>
                        <span className="skill-icon">🔧</span>
                        <span className="skill-name">{skill.name}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Tools Accordion */}
            <div className="accordion">
              <button
                className={`accordion-header ${expandedAccordions.tools ? 'expanded' : ''}`}
                onClick={() => toggleAccordion('tools')}
              >
                <span className="accordion-icon">🔧</span>
                <span className="accordion-title">Tools</span>
                <span className="accordion-arrow">{expandedAccordions.tools ? '▼' : '▶'}</span>
              </button>
              {expandedAccordions.tools && (
                <div className="accordion-content tools-tree">
                  {tools.builtin.length === 0 && tools.user.length === 0 && Object.keys(tools.mcp).length === 0 ? (
                    <div className="accordion-empty">No tools available</div>
                  ) : (
                    <>
                      {/* Builtin Tools */}
                      {tools.builtin.length > 0 && (
                        <div className="tool-group">
                          <button
                            className={`tool-group-header ${expandedToolGroups.builtin ? 'expanded' : ''}`}
                            onClick={() => setExpandedToolGroups(prev => ({ ...prev, builtin: !prev.builtin }))}
                          >
                            <span className="tool-group-arrow">{expandedToolGroups.builtin ? '▼' : '▶'}</span>
                            <span className="tool-group-icon">⚙️</span>
                            <span className="tool-group-name">Builtin</span>
                            <span className="tool-group-count">{tools.builtin.length}</span>
                          </button>
                          {expandedToolGroups.builtin && (
                            <div className="tool-group-items">
                              {tools.builtin.map((tool) => (
                                <div key={tool.name} className="tool-item" title={formatToolTooltip(tool)}>
                                  <span className="tool-name">{tool.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* User Defined Tools */}
                      {tools.user.length > 0 && (
                        <div className="tool-group">
                          <button
                            className={`tool-group-header ${expandedToolGroups.user ? 'expanded' : ''}`}
                            onClick={() => setExpandedToolGroups(prev => ({ ...prev, user: !prev.user }))}
                          >
                            <span className="tool-group-arrow">{expandedToolGroups.user ? '▼' : '▶'}</span>
                            <span className="tool-group-icon">📝</span>
                            <span className="tool-group-name">User Defined</span>
                            <span className="tool-group-count">{tools.user.length}</span>
                          </button>
                          {expandedToolGroups.user && (
                            <div className="tool-group-items">
                              {tools.user.map((tool) => (
                                <div key={tool.name} className="tool-item" title={formatToolTooltip(tool)}>
                                  <span className="tool-name">{tool.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* MCP Tools by Server */}
                      {Object.entries(tools.mcp).map(([serverName, serverTools]) => (
                        <div key={serverName} className="tool-group">
                          <button
                            className={`tool-group-header ${expandedToolGroups[`mcp_${serverName}`] ? 'expanded' : ''}`}
                            onClick={() => setExpandedToolGroups(prev => ({ ...prev, [`mcp_${serverName}`]: !prev[`mcp_${serverName}`] }))}
                          >
                            <span className="tool-group-arrow">{expandedToolGroups[`mcp_${serverName}`] ? '▼' : '▶'}</span>
                            <span className="tool-group-icon">🔌</span>
                            <span className="tool-group-name">MCP: {serverName}</span>
                            <span className="tool-group-count">{serverTools.length}</span>
                          </button>
                          {expandedToolGroups[`mcp_${serverName}`] && (
                            <div className="tool-group-items">
                              {serverTools.map((tool) => (
                                <div key={tool.name} className="tool-item" title={formatToolTooltip(tool)}>
                                  <span className="tool-name">{tool.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* MCPs Accordion */}
            <div className="accordion">
              <button
                className={`accordion-header ${expandedAccordions.mcps ? 'expanded' : ''}`}
                onClick={() => toggleAccordion('mcps')}
              >
                <span className="accordion-icon">🔌</span>
                <span className="accordion-title">MCPs</span>
                <span className="accordion-arrow">{expandedAccordions.mcps ? '▼' : '▶'}</span>
              </button>
              {expandedAccordions.mcps && (
                <div className="accordion-content">
                  {mcps.length === 0 ? (
                    <div className="accordion-empty">No MCPs connected</div>
                  ) : (
                    mcps.map((mcp) => (
                      <div key={mcp.id} className="accordion-item mcp-item">
                        <span className={`mcp-status ${mcp.enabled ? 'connected' : 'disconnected'}`}>●</span>
                        <span className="mcp-name">{mcp.name}</span>
                        {mcp.toolCount > 0 && (
                          <span className="mcp-tool-count" title={`${mcp.toolCount} tools`}>
                            {mcp.toolCount}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          </>
        )}
      </aside>

      {/* Main Chat Area */}
      <div className="main-content">
        <header className="header">
          <div className="header-left">
            {!sidebarOpen && (
              <button
                className="mobile-menu-btn"
                onClick={() => setSidebarOpen(true)}
                title="Open sidebar"
              >
                ☰
              </button>
            )}
            <div className="logo">
              <span className="logo-icon">🤖</span>
              <h1>OllieBot</h1>
            </div>
          </div>
          <div className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </header>

        <main className="chat-container">
          <div className="messages" ref={messagesContainerRef} onScroll={handleScroll}>
          {messages.length === 0 && (
            <div className="welcome">
              <h2>Welcome to OllieBot</h2>
              <p>Your personal support agent is ready to help.</p>
            </div>
          )}
          {messages.map((msg) => (
            msg.role === 'tool' ? (
              // Expandable tool invocation display
              <div key={msg.id} className={`tool-event-wrapper ${expandedTools.has(msg.id) ? 'expanded' : ''}`}>
                <div
                  className={`tool-event ${msg.status}`}
                  onClick={() => toggleToolExpand(msg.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="tool-icon">
                    {msg.source === 'mcp' ? '🔌' : msg.source === 'skill' ? '⚡' : '🔧'}
                  </span>
                  <span className="tool-status-indicator">
                    {msg.status === 'running' ? '◐' : msg.status === 'completed' ? '✓' : '✗'}
                  </span>
                  <span className="tool-name">{msg.toolName}</span>
                  {msg.parameters?.task && (
                    <span className="tool-mission">{msg.parameters.task}</span>
                  )}
                  {msg.durationMs !== undefined && (
                    <span className="tool-duration">{msg.durationMs}ms</span>
                  )}
                  <span className="tool-expand-icon">
                    {expandedTools.has(msg.id) ? '▼' : '▶'}
                  </span>
                </div>
                {expandedTools.has(msg.id) && (
                  <div className="tool-details">
                    {msg.parameters && Object.keys(msg.parameters).length > 0 && (
                      <div className="tool-details-section">
                        <div className="tool-details-label">Parameters</div>
                        <pre className="tool-details-content">
                          {JSON.stringify(msg.parameters, null, 2)}
                        </pre>
                      </div>
                    )}
                    {msg.result && (
                      <div className="tool-details-section">
                        <div className="tool-details-label">Response</div>
                        {renderToolResult(msg.result)}
                      </div>
                    )}
                    {msg.error && (
                      <div className="tool-details-section error">
                        <div className="tool-details-label">Error</div>
                        <pre className="tool-details-content">{msg.error}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : msg.role === 'delegation' ? (
              // Compact delegation display
              <div key={msg.id} className="delegation-event">
                <span className="delegation-icon">🎯</span>
                <span className="delegation-agent">
                  {msg.agentEmoji} {msg.agentName}
                </span>
                <span className="delegation-mission">{msg.mission}</span>
              </div>
            ) : msg.role === 'task_run' ? (
              // Compact task run display
              <div key={msg.id} className="task-run-event">
                <span className="task-run-icon">📋</span>
                <span className="task-run-label">Running Task</span>
                <span className="task-run-name">{msg.taskName}</span>
                {msg.taskDescription && (
                  <span className="task-run-description">{msg.taskDescription}</span>
                )}
              </div>
            ) : (
            <div key={msg.id} className={`message ${msg.role}${msg.isError ? ' error' : ''}${msg.isStreaming ? ' streaming' : ''}`}>
              <div className="message-avatar">
                {msg.isError ? '⚠️' : msg.role === 'user' ? '👤' : (msg.agentEmoji || '🤖')}
              </div>
              <div className="message-content">
                {msg.agentName && msg.role === 'assistant' && (
                  <div className="agent-name">{msg.agentName}</div>
                )}
                {renderContent(msg.content, msg.html)}
                {msg.isStreaming && (
                          <span className="typing-indicator">
                            <span className="dot"></span>
                            <span className="dot"></span>
                            <span className="dot"></span>
                          </span>
                        )}
                {msg.buttons && (
                  <div className="message-buttons">
                    {msg.buttons.map((btn) => (
                      <button
                        key={btn.id}
                        onClick={() => handleAction(btn.action, btn.data)}
                        className="action-button"
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )
          ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Scroll to bottom button */}
          {showScrollButton && (
            <button className="scroll-to-bottom" onClick={scrollToBottom}>
              ↓ Scroll to bottom
            </button>
          )}

          {/* A2UI Interaction Modal */}
        {pendingInteraction && (
          <div className="interaction-overlay">
            <div className="interaction-modal">
              <h3>{pendingInteraction.title}</h3>
              <p>{pendingInteraction.message}</p>

              {pendingInteraction.options && (
                <div className="interaction-options">
                  {pendingInteraction.options.map((opt) => (
                    <button
                      key={opt.id}
                      className={`interaction-btn ${opt.style || 'secondary'}`}
                      onClick={() =>
                        handleInteractionResponse({ selectedOption: opt.id })
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {pendingInteraction.fields && (
                <form
                  className="interaction-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formData = {};
                    pendingInteraction.fields.forEach((field) => {
                      formData[field.id] = e.target[field.id]?.value;
                    });
                    handleInteractionResponse({ formData });
                  }}
                >
                  {pendingInteraction.fields.map((field) => (
                    <div key={field.id} className="form-field">
                      <label htmlFor={field.id}>{field.label}</label>
                      {field.type === 'textarea' ? (
                        <textarea
                          id={field.id}
                          name={field.id}
                          placeholder={field.placeholder}
                          required={field.required}
                        />
                      ) : field.type === 'select' ? (
                        <select id={field.id} name={field.id} required={field.required}>
                          {field.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={field.id}
                          name={field.id}
                          type={field.type}
                          placeholder={field.placeholder}
                          required={field.required}
                        />
                      )}
                    </div>
                  ))}
                  <button type="submit" className="interaction-btn primary">
                    Submit
                  </button>
                </form>
              )}

              <button
                className="interaction-cancel"
                onClick={() =>
                  handleInteractionResponse({ status: 'cancelled' })
                }
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        </main>

        <footer className="input-container">
          <form onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              disabled={!isConnected}
            />
            <button type="submit" disabled={!isConnected || !input.trim()}>
              Send
            </button>
          </form>
        </footer>
      </div>
    </div>
  );
}

export default App;
