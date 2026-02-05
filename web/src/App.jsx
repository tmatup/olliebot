import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useWebSocket } from './hooks/useWebSocket';
import HtmlPreview from './components/HtmlPreview';
import { EvalSidebar, EvalRunner } from './components/eval';

// Mode constants
const MODES = {
  CHAT: 'chat',
  EVAL: 'eval',
};
import { BrowserSessions } from './components/BrowserSessions';
import { BrowserPreview } from './components/BrowserPreview';
import RAGProjects from './components/RAGProjects';
import { SourcePanel } from './components/SourcePanel';
import { ChatInput } from './components/ChatInput';
import { playAudioData } from './utils/audio';

// Code block component with copy button and language header
// Uses deferred rendering for faster initial display
function CodeBlock({ language, children }) {
  const [copied, setCopied] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const hasLanguage = language && language !== 'text';

  // Defer syntax highlighting until browser is idle
  useEffect(() => {
    const scheduleRender = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
    const id = scheduleRender(() => setIsReady(true), { timeout: 100 });
    return () => {
      if (window.cancelIdleCallback) {
        window.cancelIdleCallback(id);
      } else {
        clearTimeout(id);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className={`code-block-container ${hasLanguage ? 'has-header' : ''}`}>
      {hasLanguage && (
        <div className="code-block-header">
          <span className="code-block-language">{language}</span>
        </div>
      )}
      <button
        className={`code-copy-button ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? '✓' : '⧉'}
      </button>
      {isReady ? (
        <SyntaxHighlighter
          style={oneDark}
          language={language || 'text'}
          PreTag="div"
          className="code-block-highlighted"
          customStyle={{
            margin: 0,
            borderRadius: hasLanguage ? '0 0 6px 6px' : '6px',
            fontSize: '13px',
          }}
        >
          {children}
        </SyntaxHighlighter>
      ) : (
        <div
          className="code-block-placeholder"
          style={{
            margin: 0,
            padding: '1em',
            borderRadius: hasLanguage ? '0 0 6px 6px' : '6px',
            fontSize: '13px',
            background: '#282c34',
            color: '#abb2bf',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
            maxHeight: '200px',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// Static markdown components that don't depend on props (defined once, reused)
const staticMarkdownComponents = {
  pre({ children }) {
    return <div className="code-block-wrapper">{children}</div>;
  },
  table({ children }) {
    return (
      <div className="table-wrapper">
        <table>{children}</table>
      </div>
    );
  },
};

// Rehype plugin arrays (stable references)
const rehypePluginsWithHtml = [rehypeRaw, rehypeSanitize];
const rehypePluginsDefault = [rehypeSanitize];
const remarkPluginsDefault = [remarkGfm];

// Factory to create code component (only recreated when isStreaming changes)
function createCodeComponent(isStreaming) {
  return function CodeComponent({ node, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : null;
    const isBlock = match || (node?.tagName === 'code' && node?.parent?.tagName === 'pre');

    if (isBlock) {
      const codeContent = String(children).replace(/\n$/, '');
      if (language === 'html' || language === 'htm') {
        return <HtmlPreview html={codeContent} isStreaming={isStreaming} />;
      }
      return <CodeBlock language={language}>{codeContent}</CodeBlock>;
    }
    return (
      <code className="inline-code" {...props}>
        {children}
      </code>
    );
  };
}

// Cache for markdown components keyed by isStreaming value
const markdownComponentsCache = new Map();
function getMarkdownComponents(isStreaming) {
  if (!markdownComponentsCache.has(isStreaming)) {
    markdownComponentsCache.set(isStreaming, {
      ...staticMarkdownComponents,
      code: createCodeComponent(isStreaming),
    });
  }
  return markdownComponentsCache.get(isStreaming);
}

/**
 * Message content component for rendering markdown messages.
 * Memoized to prevent re-renders when parent re-renders with same props.
 */
const MessageContent = memo(function MessageContent({ content, html = false, isStreaming = false }) {
  const components = getMarkdownComponents(isStreaming);
  const rehypePlugins = html ? rehypePluginsWithHtml : rehypePluginsDefault;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - check each prop for equality
  return (
    prevProps.content === nextProps.content &&
    prevProps.html === nextProps.html &&
    prevProps.isStreaming === nextProps.isStreaming
  );
});

// Module-level flag to prevent double-fetching in React Strict Mode
// (Strict Mode unmounts/remounts component, so refs don't persist)
let appInitialLoadDone = false;

// Agent types that should have their responses collapsed by default (module-level constant)
const COLLAPSE_BY_DEFAULT_AGENT_TYPES = new Set([
  'research-worker',
  'research-reviewer',
]);

// Map display names to agent type IDs (for legacy messages without agentType)
const AGENT_NAME_TO_TYPE = {
  'Research Worker': 'research-worker',
  'Research Reviewer': 'research-reviewer',
  'Deep Research Lead': 'deep-research-lead',
};

// Helper function to check if an agent type should collapse by default
function shouldCollapseByDefault(agentType, agentName) {
  if (agentType && COLLAPSE_BY_DEFAULT_AGENT_TYPES.has(agentType)) {
    return true;
  }
  if (agentName) {
    const mappedType = AGENT_NAME_TO_TYPE[agentName];
    if (mappedType && COLLAPSE_BY_DEFAULT_AGENT_TYPES.has(mappedType)) {
      return true;
    }
  }
  return false;
}

// Helper to transform message data from API format (pure function, no component deps)
function transformMessages(data) {
  return data.map((msg) => {
    let role = msg.role;
    if (msg.messageType === 'task_run') role = 'task_run';
    else if (msg.messageType === 'tool_event' || msg.role === 'tool') role = 'tool';
    else if (msg.messageType === 'delegation') role = 'delegation';

    return {
      id: msg.id,
      role,
      content: msg.content,
      timestamp: msg.createdAt,
      agentName: msg.agentName || msg.delegationAgentId,
      agentEmoji: msg.agentEmoji,
      attachments: msg.attachments,
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
      agentType: msg.agentType || msg.delegationAgentType || (msg.agentName?.includes('-') ? msg.agentName : undefined),
      mission: msg.delegationMission,
      reasoningMode: msg.reasoningMode,
      messageType: msg.messageType,
      citations: msg.citations,
    };
  });
}

// Audio player component - play button for on-demand playback
function AudioPlayer({ audioBase64, mimeType }) {
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlay = async () => {
    setIsPlaying(true);
    await playAudioData(audioBase64, mimeType);
    setIsPlaying(false);
  };

  return (
    <button
      className={`audio-play-button ${isPlaying ? 'playing' : ''}`}
      onClick={handlePlay}
      disabled={isPlaying}
    >
      {isPlaying ? '🔊 Playing...' : '▶️ Play'}
    </button>
  );
}

function App() {
  // Router hooks
  const navigate = useNavigate();
  const location = useLocation();

  // Derive mode from URL path
  const mode = location.pathname.startsWith('/eval') ? MODES.EVAL : MODES.CHAT;

  const [messages, setMessages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
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
    browserSessions: false,
    ragProjects: false,
  });
  const [agentTasks, setAgentTasks] = useState([]);
  const [skills, setSkills] = useState([]);
  const [mcps, setMcps] = useState([]);
  const [tools, setTools] = useState({ builtin: [], user: [], mcp: {} });
  const [expandedToolGroups, setExpandedToolGroups] = useState({});

  // Browser session state
  const [browserSessions, setBrowserSessions] = useState([]);
  const [selectedBrowserSessionId, setSelectedBrowserSessionId] = useState(null);
  const [browserScreenshots, setBrowserScreenshots] = useState({});
  const [clickMarkers, setClickMarkers] = useState([]);

  // RAG projects state
  const [ragProjects, setRagProjects] = useState([]);
  const [ragIndexingProgress, setRagIndexingProgress] = useState({}); // { projectId: { status, ... } }

  // Actions menu state
  const [openMenuId, setOpenMenuId] = useState(null);

  // Inline rename state
  const [editingConversationId, setEditingConversationId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const renameInputRef = useRef(null);

  // Auto-scroll state
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Expanded tool events
  const [expandedTools, setExpandedTools] = useState(new Set());

  // Expanded agent messages (for agents that collapse by default, like research-worker)
  const [expandedAgentMessages, setExpandedAgentMessages] = useState(new Set());

  // Eval mode state
  const [selectedEvaluation, setSelectedEvaluation] = useState(null);
  const [selectedSuite, setSelectedSuite] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [viewingResults, setViewingResults] = useState(null);
  // Response pending state (disable input while waiting)
  const [isResponsePending, setIsResponsePending] = useState(false);

  // Reasoning mode state
  const [reasoningMode, setReasoningMode] = useState(null); // null | 'high' | 'xhigh'
  const [messageType, setMessageType] = useState(null); // null | 'deep_research'
  const [modelCapabilities, setModelCapabilities] = useState({ reasoningEfforts: [] });

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const chatInputRef = useRef(null);

  // Ref to track current conversation ID for use in callbacks
  const currentConversationIdRef = useRef(currentConversationId);

  // Ref to track navigate function for use in callbacks
  const navigateRef = useRef(navigate);

  // Update refs via effect (not during render - React Compiler requirement)
  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const handleMessage = (data) => {
    // Helper to check if message belongs to current conversation
    const isForCurrentConversation = (msgConversationId) => {
      // If no conversationId specified, assume it's for current conversation
      if (!msgConversationId) return true;
      // If no current conversation, accept all messages
      if (!currentConversationIdRef.current) return true;
      // Otherwise, check if it matches
      return msgConversationId === currentConversationIdRef.current;
    };
    if (data.type === 'message') {
      // Only show messages for current conversation
      if (!isForCurrentConversation(data.conversationId)) return;

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
      // Only show streams for current conversation
      if (!isForCurrentConversation(data.conversationId)) return;

      // Start a new streaming message
      setMessages((prev) => {
        // Find the most recent user message to get reasoning mode and message type
        const lastUserMsg = [...prev].reverse().find(m => m.role === 'user');
        return [
          ...prev,
          {
            id: data.id,
            role: 'assistant',
            content: '',
            timestamp: data.timestamp,
            isStreaming: true,
            agentName: data.agentName,
            agentEmoji: data.agentEmoji,
            agentType: data.agentType,
            reasoningMode: lastUserMsg?.reasoningMode || null,
            messageType: lastUserMsg?.messageType || null,
          },
        ];
      });
    } else if (data.type === 'stream_chunk') {
      // Only process chunks for current conversation
      if (!isForCurrentConversation(data.conversationId)) return;

      // Append chunk to streaming message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.streamId
            ? { ...m, content: m.content + data.chunk }
            : m
        )
      );
    } else if (data.type === 'stream_end') {
      // Only process stream end for current conversation
      if (!isForCurrentConversation(data.conversationId)) return;

      // Debug: log citation data
      if (data.citations) {
        console.log('[Citations] Received in stream_end:', data.citations);
      } else {
        console.log('[Citations] No citations in stream_end');
      }

      // Mark streaming as complete and attach citations if present
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.streamId
            ? { ...m, isStreaming: false, citations: data.citations }
            : m
        )
      );
      setIsResponsePending(false);
    } else if (data.type === 'error') {
      // Only show errors for current conversation
      if (!isForCurrentConversation(data.conversationId)) return;

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
      setIsResponsePending(false);
    } else if (data.type === 'connected') {
      setIsConnected(true);
    } else if (data.type === 'interaction') {
      // A2UI interaction request
      setPendingInteraction(data.request);
    } else if (data.type === 'tool_requested') {
      // Only show tool requests for current conversation
      if (!isForCurrentConversation(data.conversationId)) return;

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
    } else if (data.type === 'play_audio') {
      // Play audio immediately (sent from speak tool via emitToolEvent)
      if (data.audio && typeof data.audio === 'string') {
        playAudioData(data.audio, data.mimeType || 'audio/pcm;rate=24000');
      }
    } else if (data.type === 'tool_execution_finished') {
      // Only process tool results for current conversation
      if (!isForCurrentConversation(data.conversationId)) return;

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
      // Only show delegations for current conversation
      if (!isForCurrentConversation(data.conversationId)) return;

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
        const newConv = {
          id: conv.id,
          title: conv.title,
          updatedAt: conv.updatedAt,
          isWellKnown: false,
        };
        // Insert after well-known conversations
        const wellKnownCount = prev.filter((c) => c.isWellKnown).length;
        return [...prev.slice(0, wellKnownCount), newConv, ...prev.slice(wellKnownCount)];
      });
      setCurrentConversationId(conv.id);
      // Navigate to the new conversation URL
      navigateRef.current(`/chat/${encodeURIComponent(conv.id)}`, { replace: true });
    } else if (data.type === 'conversation_updated') {
      // Conversation title or metadata was updated
      const { id, title, updatedAt, manuallyNamed } = data.conversation;
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          // Don't override manually named conversations with auto-generated titles
          if (c.manuallyNamed && !manuallyNamed) return c;
          return {
            ...c,
            title: title || c.title,
            updatedAt: updatedAt || c.updatedAt,
            manuallyNamed: manuallyNamed || c.manuallyNamed,
          };
        })
      );
    } else if (data.type === 'task_updated') {
      // Task was updated (e.g., after execution)
      setAgentTasks((prev) =>
        prev.map((t) =>
          t.id === data.task.id ? { ...t, ...data.task } : t
        )
      );
    } else if (data.type === 'browser_session_created') {
      // New browser session was created
      setBrowserSessions((prev) => {
        if (prev.some((s) => s.id === data.session.id)) return prev;
        return [...prev, data.session];
      });
      // Auto-expand accordion when first session is created
      setExpandedAccordions((prev) => ({ ...prev, browserSessions: true }));
    } else if (data.type === 'browser_session_updated') {
      // Browser session was updated
      setBrowserSessions((prev) =>
        prev.map((s) =>
          s.id === data.sessionId ? { ...s, ...data.updates } : s
        )
      );
    } else if (data.type === 'browser_session_closed') {
      // Browser session was closed
      setBrowserSessions((prev) => prev.filter((s) => s.id !== data.sessionId));
      // Clear screenshot for this session
      setBrowserScreenshots((prev) => {
        const next = { ...prev };
        delete next[data.sessionId];
        return next;
      });
      // Clear selection if this was selected
      setSelectedBrowserSessionId((prev) => prev === data.sessionId ? null : prev);
      // Remove click markers for this session
      setClickMarkers((prev) => prev.filter((m) => m.sessionId !== data.sessionId));
    } else if (data.type === 'browser_screenshot') {
      // New screenshot from browser session
      setBrowserScreenshots((prev) => ({
        ...prev,
        [data.sessionId]: {
          screenshot: data.screenshot,
          url: data.url,
          timestamp: data.timestamp,
        },
      }));
    } else if (data.type === 'browser_click_marker') {
      // Click marker for visualization
      const marker = {
        ...data.marker,
        id: `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        sessionId: data.sessionId,
      };
      setClickMarkers((prev) => [...prev, marker]);
      // Auto-remove marker after animation completes (1.5s)
      setTimeout(() => {
        setClickMarkers((prev) => prev.filter((m) => m.id !== marker.id));
      }, 1500);
    } else if (data.type === 'rag_indexing_started') {
      // RAG indexing started
      setRagIndexingProgress((prev) => ({
        ...prev,
        [data.projectId]: {
          status: 'started',
          totalDocuments: data.totalDocuments,
          processedDocuments: 0,
        },
      }));
      // Mark project as indexing
      setRagProjects((prev) =>
        prev.map((p) =>
          p.id === data.projectId ? { ...p, isIndexing: true } : p
        )
      );
    } else if (data.type === 'rag_indexing_progress') {
      // RAG indexing progress update
      setRagIndexingProgress((prev) => ({
        ...prev,
        [data.projectId]: {
          status: 'processing',
          totalDocuments: data.totalDocuments,
          processedDocuments: data.processedDocuments,
          currentDocument: data.currentDocument,
        },
      }));
    } else if (data.type === 'rag_indexing_completed') {
      // RAG indexing completed - remove from progress map
      setRagIndexingProgress((prev) => {
        const next = { ...prev };
        delete next[data.projectId];
        return next;
      });
      // Refresh project data
      fetch('/api/rag/projects')
        .then((res) => res.ok ? res.json() : [])
        .then((projects) => setRagProjects(projects))
        .catch(() => {});
    } else if (data.type === 'rag_indexing_error') {
      // RAG indexing error
      setRagIndexingProgress((prev) => ({
        ...prev,
        [data.projectId]: {
          status: 'error',
          error: data.error,
        },
      }));
      // Clear progress after a delay
      setTimeout(() => {
        setRagIndexingProgress((prev) => {
          const next = { ...prev };
          delete next[data.projectId];
          return next;
        });
      }, 5000);
      // Mark project as not indexing
      setRagProjects((prev) =>
        prev.map((p) =>
          p.id === data.projectId ? { ...p, isIndexing: false } : p
        )
      );
    } else if (data.type === 'rag_projects_changed') {
      // RAG projects folder changed, refresh list
      fetch('/api/rag/projects')
        .then((res) => res.ok ? res.json() : [])
        .then((projects) => setRagProjects(projects))
        .catch(() => {});
    }
  };

  // Ref to hold the loadStartupData function (updated via effect)
  const loadStartupDataRef = useRef(null);

  // Update loadStartupData ref via effect (not during render)
  useEffect(() => {
    loadStartupDataRef.current = async () => {
      try {
        const res = await fetch('/api/startup');
        if (!res.ok) {
          console.error('Startup API not available');
          setConversations([]);
          setCurrentConversationId(null);
          setMessages([]);
          setConversationsLoading(false);
          setShowSkeleton(false);
          return;
        }
        const data = await res.json();

        // Model capabilities
        setModelCapabilities(data.modelCapabilities);

        // Conversations
        const mappedConversations = data.conversations.map(c => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt || c.updated_at,
          isWellKnown: c.isWellKnown || false,
          icon: c.icon,
        }));
        setConversations(mappedConversations);

        // Set default conversation
        const feedConversation = mappedConversations.find(c => c.id === ':feed:');
        if (feedConversation) {
          setCurrentConversationId(feedConversation.id);
        } else if (mappedConversations.length > 0) {
          setCurrentConversationId(mappedConversations[0].id);
        }

        // Messages - transform API format to internal format
        setMessages(data.messages.map((msg) => {
          let role = msg.role;
          if (msg.messageType === 'task_run') role = 'task_run';
          else if (msg.messageType === 'tool_event' || msg.role === 'tool') role = 'tool';
          else if (msg.messageType === 'delegation') role = 'delegation';

          return {
            id: msg.id,
            role,
            content: msg.content,
            timestamp: msg.createdAt,
            agentName: msg.agentName || msg.delegationAgentId,
            agentEmoji: msg.agentEmoji,
            attachments: msg.attachments,
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
            agentType: msg.agentType || msg.delegationAgentType || (msg.agentName?.includes('-') ? msg.agentName : undefined),
            mission: msg.delegationMission,
            reasoningMode: msg.reasoningMode,
            messageType: msg.messageType,
            citations: msg.citations,
          };
        }));

        // Sidebar data
        setAgentTasks(data.tasks);
        setSkills(data.skills);
        setMcps(data.mcps);
        setTools(data.tools);
        const ragProjectsData = data.ragProjects;
        if (ragProjectsData) {
          setRagProjects(ragProjectsData);
        } else {
          setRagProjects([]);
        }
      } catch (error) {
        console.error('Failed to load startup data:', error);
        setConversations([]);
        setCurrentConversationId(null);
        setMessages([]);
      }
      setConversationsLoading(false);
      setShowSkeleton(false);
    };
  }, []);

  // Track if this is the first connection (to avoid refreshing on initial connect)
  const hasConnectedOnce = useRef(false);

  const handleOpen = () => {
    setIsConnected(true);
    // Only refresh data on REconnection, not initial connection
    // (initial data load is handled by the mount useEffect)
    if (hasConnectedOnce.current) {
      loadStartupDataRef.current?.();
    }
    hasConnectedOnce.current = true;
  };
  const handleClose = () => setIsConnected(false);

  const { sendMessage, connectionState } = useWebSocket({
    onMessage: handleMessage,
    onOpen: handleOpen,
    onClose: handleClose,
  });

  // Load all startup data on mount (single consolidated API call)
  useEffect(() => {
    // Guard against React Strict Mode double-invocation
    if (appInitialLoadDone) return;
    appInitialLoadDone = true;

    // Show skeleton after 500ms if still loading
    const skeletonTimer = setTimeout(() => {
      setShowSkeleton(true);
    }, 500);

    loadStartupDataRef.current?.().finally(() => clearTimeout(skeletonTimer));

    return () => clearTimeout(skeletonTimer);
  }, []);

  // Smart auto-scroll - only scroll if user hasn't manually scrolled up
  // Uses instant scroll (not smooth) so it doesn't create ongoing animations that fight with user input
  useEffect(() => {
    if (!isUserScrolled && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
    }
  }, [messages, isUserScrolled]);

  // Sync URL to state for chat mode deep linking
  // Ref to prevent re-triggering when we programmatically set state
  const isNavigatingRef = useRef(false);

  useEffect(() => {
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }

    const path = location.pathname;

    // Handle chat routes
    if (path === '/' || path === '/chat') {
      // Default to feed view
      if (currentConversationId !== ':feed:' && conversations.some(c => c.id === ':feed:')) {
        setCurrentConversationId(':feed:');
        // Load feed messages
        fetch('/api/conversations/:feed:/messages')
          .then(res => res.ok ? res.json() : [])
          .then(data => setMessages(transformMessages(data)))
          .catch(() => setMessages([]));
      }
    } else if (path.startsWith('/chat/')) {
      const convId = decodeURIComponent(path.slice(6)); // Remove '/chat/'
      if (convId && convId !== currentConversationId) {
        setCurrentConversationId(convId);
        // Load conversation messages
        fetch(`/api/conversations/${encodeURIComponent(convId)}/messages`)
          .then(res => res.ok ? res.json() : [])
          .then(data => setMessages(transformMessages(data)))
          .catch(() => setMessages([]));
      }
    }

    // Handle eval routes
    if (path === '/eval') {
      setSelectedEvaluation(null);
      setSelectedSuite(null);
      setSelectedResult(null);
      setViewingResults(null);
    } else if (path.startsWith('/eval/result/')) {
      const resultPath = decodeURIComponent(path.slice(13)); // Remove '/eval/result/'
      if (resultPath && (!selectedResult || selectedResult.filePath !== resultPath)) {
        const resultInfo = { filePath: resultPath };
        setSelectedResult(resultInfo);
        setSelectedEvaluation(null);
        setSelectedSuite(null);
        // Fetch full result data
        fetch(`/api/eval/result/${encodeURIComponent(resultPath)}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data?.result) setViewingResults(data.result);
          })
          .catch(err => console.error('Failed to load result:', err));
      }
    } else if (path.startsWith('/eval/suite/')) {
      const suitePath = decodeURIComponent(path.slice(12)); // Remove '/eval/suite/'
      if (suitePath && (!selectedSuite || selectedSuite.suitePath !== suitePath)) {
        setSelectedSuite({ suitePath });
        setSelectedEvaluation(null);
        setSelectedResult(null);
        setViewingResults(null);
      }
    } else if (path.startsWith('/eval/')) {
      const evalPath = decodeURIComponent(path.slice(6)); // Remove '/eval/'
      if (evalPath && (!selectedEvaluation || selectedEvaluation.path !== evalPath)) {
        setSelectedEvaluation({ path: evalPath });
        setSelectedSuite(null);
        setSelectedResult(null);
        setViewingResults(null);
      }
    }
  }, [location.pathname, conversations, currentConversationId, selectedEvaluation, selectedResult, selectedSuite, transformMessages]);

  // Redirect root to /chat
  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/chat', { replace: true });
    }
  }, [location.pathname, navigate]);

  // Track if we're programmatically scrolling (to avoid scroll event interference)
  const isScrollingToBottom = useRef(false);

  // Handle wheel events - immediately disengage auto-scroll when user scrolls up
  const handleWheel = (e) => {
    if (e.deltaY < 0) {
      // User is scrolling UP - immediately disengage auto-scroll
      setIsUserScrolled(true);
      setShowScrollButton(true);
    }
  };

  // Handle scroll events to detect scroll position (only controls button visibility)
  const handleScroll = () => {
    // Ignore scroll events during programmatic scroll
    if (isScrollingToBottom.current) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    // Only control button visibility - don't change auto-scroll state here
    // Auto-scroll is only re-enabled by clicking the "scroll to bottom" button
    if (distanceFromBottom < 50) {
      setShowScrollButton(false);
    } else {
      setShowScrollButton(true);
    }
  };

  // Scroll to bottom handler
  const scrollToBottom = () => {
    isScrollingToBottom.current = true;
    setIsUserScrolled(false);
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Reset flag after animation completes
    setTimeout(() => {
      isScrollingToBottom.current = false;
    }, 500);
  };

  // Helper to insert a new conversation after well-known ones
  const insertConversation = (prev, newConv) => {
    const wellKnownCount = prev.filter((c) => c.isWellKnown).length;
    return [...prev.slice(0, wellKnownCount), newConv, ...prev.slice(wellKnownCount)];
  };

  // Start a new conversation
  const handleNewConversation = async () => {
    try {
      // Create conversation on server
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      });

      if (res.ok) {
        const newConv = await res.json();
        setConversations((prev) => insertConversation(prev, {
          id: newConv.id,
          title: newConv.title,
          updatedAt: newConv.updatedAt || new Date().toISOString(),
          isWellKnown: false,
        }));
        setCurrentConversationId(newConv.id);
        // Navigate to the new conversation URL
        navigate(`/chat/${encodeURIComponent(newConv.id)}`, { replace: true });
      }

      // Tell server to start new conversation context
      sendMessage({ type: 'new-conversation' });

      // Clear local messages
      setMessages([]);
      setIsUserScrolled(false);
      setShowScrollButton(false);
      setIsResponsePending(false);
    } catch (error) {
      console.error('Failed to create new conversation:', error);
      // Fallback to local-only
      const newId = `conv-${Date.now()}`;
      setConversations((prev) => insertConversation(prev, {
        id: newId,
        title: 'New Conversation',
        updatedAt: new Date().toISOString(),
        isWellKnown: false,
      }));
      setCurrentConversationId(newId);
      setMessages([]);
      // Navigate to the new conversation URL
      navigate(`/chat/${encodeURIComponent(newId)}`, { replace: true });
    }
  };

  // Delete conversation (soft delete)
  const handleDeleteConversation = async (convId, e) => {
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
            const nextConv = remaining[0];
            setCurrentConversationId(nextConv.id);
            // Navigate to the next conversation
            if (nextConv.id === ':feed:') {
              navigate('/chat');
            } else {
              navigate(`/chat/${encodeURIComponent(nextConv.id)}`);
            }
            // Load messages for new current conversation
            const msgRes = await fetch(`/api/conversations/${encodeURIComponent(nextConv.id)}/messages`);
            if (msgRes.ok) {
              const data = await msgRes.json();
              setMessages(transformMessages(data));
            }
          } else {
            setCurrentConversationId(null);
            setMessages([]);
            navigate('/chat');
          }
        }
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  // Start inline rename
  const handleRenameConversation = (convId, e) => {
    e.stopPropagation();
    setOpenMenuId(null);

    const conversation = conversations.find((c) => c.id === convId);
    if (!conversation) return;

    setEditingConversationId(convId);
    setEditingTitle(conversation.title);
    // Focus and select the input text after render
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  };

  // Save the rename
  const handleSaveRename = async () => {
    if (!editingConversationId) return;

    const originalConv = conversations.find((c) => c.id === editingConversationId);
    const newTitle = editingTitle.trim();

    // Cancel if empty or unchanged
    if (!newTitle || newTitle === originalConv?.title) {
      setEditingConversationId(null);
      setEditingTitle('');
      return;
    }

    try {
      const res = await fetch(`/api/conversations/${editingConversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });

      if (res.ok) {
        const data = await res.json();
        setConversations((prev) =>
          prev.map((c) =>
            c.id === editingConversationId
              ? { ...c, title: data.conversation.title, manuallyNamed: true }
              : c
          )
        );
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }

    setEditingConversationId(null);
    setEditingTitle('');
  };

  // Cancel the rename
  const handleCancelRename = () => {
    setEditingConversationId(null);
    setEditingTitle('');
  };

  // Handle keydown in rename input
  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelRename();
    }
  };

  // Toggle actions menu
  const toggleActionsMenu = (convId, e) => {
    e.stopPropagation(); // Prevent selecting the conversation
    setOpenMenuId((prev) => (prev === convId ? null : convId));
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);


  // Switch conversation - navigates to the conversation URL
  const handleSelectConversation = (convId) => {
    if (convId === currentConversationId) return;

    // Mark that we're navigating to prevent URL sync effect from re-triggering
    isNavigatingRef.current = true;
    setIsUserScrolled(false);
    setShowScrollButton(false);

    // Navigate to the conversation URL
    // Special handling for :feed: - use /chat without ID
    if (convId === ':feed:') {
      navigate('/chat');
    } else {
      navigate(`/chat/${encodeURIComponent(convId)}`);
    }

    // Update state and load messages
    setCurrentConversationId(convId);
    fetch(`/api/conversations/${encodeURIComponent(convId)}/messages`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setMessages(transformMessages(data)))
      .catch(() => setMessages([]));
  };

  // Handle chat submission - receives input text from ChatInput component
  // Uses refs to avoid dependencies that would cause callback recreation
  const attachmentsRef = useRef(attachments);
  const reasoningModeRef = useRef(reasoningMode);
  const messageTypeRef = useRef(messageType);

  // Keep refs in sync (currentConversationIdRef is already synced above)
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => { reasoningModeRef.current = reasoningMode; }, [reasoningMode]);
  useEffect(() => { messageTypeRef.current = messageType; }, [messageType]);

  // Convert file to base64 (defined before handleSubmit which uses it)
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSubmit = useCallback(async (inputText) => {
    const currentAttachments = attachmentsRef.current;
    const currentReasoningMode = reasoningModeRef.current;
    const currentMessageType = messageTypeRef.current;
    const convId = currentConversationIdRef.current;

    if (!inputText.trim() && currentAttachments.length === 0) return;

    // If user is near the bottom when sending, re-enable auto-scroll
    const container = messagesContainerRef.current;
    if (container) {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      if (distanceFromBottom < 150) {
        setIsUserScrolled(false);
      }
    }

    // Process attachments to base64
    const processedAttachments = await Promise.all(
      currentAttachments.map(async (file) => {
        const base64 = await fileToBase64(file);
        return {
          name: file.name,
          type: file.type,
          size: file.size,
          data: base64,
        };
      })
    );

    // Generate a unique message ID for deduplication (prevents React Strict Mode double-sends)
    const messageId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Add user message to UI immediately
    const userMessage = {
      id: messageId,
      role: 'user',
      content: inputText,
      attachments: currentAttachments.map(f => ({ name: f.name, type: f.type, size: f.size })),
      timestamp: new Date().toISOString(),
      reasoningMode: currentReasoningMode,
      messageType: currentMessageType,
    };
    setMessages((prev) => [...prev, userMessage]);

    // Send via WebSocket with conversation ID, attachments, reasoning effort, and message type
    sendMessage({
      type: 'message',
      messageId: messageId,
      content: inputText,
      attachments: processedAttachments,
      conversationId: convId,
      reasoningEffort: currentReasoningMode,
      messageType: currentMessageType,
    });
    setAttachments([]);
    setReasoningMode(null);
    setMessageType(null);
    setIsResponsePending(true);
  }, [sendMessage]);

  // Handle file drop
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    setAttachments((prev) => [...prev, ...files]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  // Handle paste - extract images from clipboard
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          // Create a named file (clipboard images don't have names)
          const namedFile = new File([file], `pasted-image-${Date.now()}.png`, { type: file.type });
          imageFiles.push(namedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      setAttachments((prev) => [...prev, ...imageFiles]);
    }
  }, []);

  // Remove attachment
  const removeAttachment = useCallback((index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAction = (action, data) => {
    sendMessage({ type: 'action', action, data, conversationId: currentConversationId });
  };

  const handleInteractionResponse = (response) => {
    if (!pendingInteraction) return;
    sendMessage({
      type: 'interaction-response',
      requestId: pendingInteraction.id,
      conversationId: currentConversationId,
      ...response,
    });
    setPendingInteraction(null);
  };

  // Run a task immediately
  const handleRunTask = async (taskId) => {
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
  };

  // Helper to check if a value is a data URL image
  const isDataUrlImage = (value) => {
    return typeof value === 'string' && value.startsWith('data:image/');
  };

  // Helper to check if result contains audio data (tool-agnostic)
  const isAudioResult = (obj) => {
    if (!obj || typeof obj !== 'object') return false;
    // Check for audio field with base64 data (long string)
    return obj.audio && typeof obj.audio === 'string' && obj.audio.length > 100;
  };

  // Render tool result with special handling for images and audio
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

    // If parsedResult is an object, check for special content types
    if (typeof parsedResult === 'object' && parsedResult !== null) {
      // Check for audio result (any tool returning audio data)
      if (isAudioResult(parsedResult)) {
        // Get non-audio properties to display alongside player
        const nonAudioEntries = Object.entries(parsedResult).filter(
          ([key]) => key !== 'audio'
        );

        return (
          <div className="tool-result-with-audio">
            <AudioPlayer
              audioBase64={parsedResult.audio}
              mimeType={parsedResult.mimeType || 'audio/pcm;rate=24000'}
            />
            {nonAudioEntries.length > 0 && (
              <div className="tool-result-properties">
                {nonAudioEntries.map(([key, value]) => (
                  <div key={key} className="tool-result-property">
                    <span className="tool-result-key">{key}:</span>{' '}
                    <span className="tool-result-value">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      // Check for image data URLs
      const imageEntries = Object.entries(parsedResult).filter(
        ([, value]) => isDataUrlImage(value)
      );
      const hasImageData = imageEntries.length > 0;

      if (hasImageData) {
        // Render with image preview - show images first, then other properties
        const nonImageEntries = Object.entries(parsedResult).filter(
          ([, value]) => !isDataUrlImage(value)
        );

        return (
          <div className="tool-result-with-image">
            {/* Render images first */}
            {imageEntries.map(([key, value]) => (
              <div key={key} className="tool-result-image">
                <div className="tool-result-image-label">{key}:</div>
                <img src={value} alt={key} style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '4px' }} />
              </div>
            ))}
            {/* Render other properties */}
            {nonImageEntries.map(([key, value]) => (
              <div key={key} className="tool-result-property">
                <span className="tool-result-key">{key}:</span>{' '}
                <span className="tool-result-value">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
        );
      }
    }

    // Default: render as JSON
    return <pre className="tool-details-content">{JSON.stringify(parsedResult, null, 2)}</pre>;
  };

  // Format file size for display
  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Toggle accordion - memoized since it only uses state setter
  const toggleAccordion = useCallback((key) => {
    setExpandedAccordions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  // Format tool tooltip with description and inputs
  const formatToolTooltip = (tool) => {
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
  };

  // Toggle tool event expansion
  const toggleToolExpand = (toolId) => {
    setExpandedTools((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(toolId)) {
        newSet.delete(toolId);
      } else {
        newSet.add(toolId);
      }
      return newSet;
    });
  };

  // Toggle agent message expansion (for messages that collapse by default)
  const toggleAgentMessageExpand = (msgId) => {
    setExpandedAgentMessages((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(msgId)) {
        newSet.delete(msgId);
      } else {
        newSet.add(msgId);
      }
      return newSet;
    });
  };

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

  // Eval mode handlers - memoized for EvalSidebar/EvalRunner
  const handleSelectEvaluation = useCallback((evaluation) => {
    if (evaluation) {
      navigate(`/eval/${encodeURIComponent(evaluation.path)}`);
    } else {
      navigate('/eval');
    }
  }, [navigate]);

  const handleSelectSuite = useCallback((suite) => {
    if (suite) {
      navigate(`/eval/suite/${encodeURIComponent(suite.suitePath)}`);
    } else {
      navigate('/eval');
    }
  }, [navigate]);

  const handleSelectResult = useCallback((resultInfo) => {
    if (resultInfo) {
      navigate(`/eval/result/${encodeURIComponent(resultInfo.filePath)}`);
    } else {
      navigate('/eval');
    }
  }, [navigate]);

  const handleEvalBack = useCallback(() => {
    navigate('/eval');
  }, [navigate]);

  // Handle browser session selection - memoized
  const handleSelectBrowserSession = useCallback((sessionId) => {
    setSelectedBrowserSessionId(sessionId);
  }, []);

  // Close browser preview
  const handleCloseBrowserPreview = useCallback(() => {
    setSelectedBrowserSessionId(null);
  }, []);

  // Close browser session (terminate the browser process) - memoized
  const handleCloseBrowserSession = useCallback((sessionId) => {
    // Optimistically remove from UI immediately
    setBrowserSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setBrowserScreenshots((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    // Use functional update to check selected session without dependency
    setSelectedBrowserSessionId((prev) => prev === sessionId ? null : prev);
    // Send close request to server
    sendMessage({ type: 'browser-action', action: 'close', sessionId });
  }, [sendMessage]);

  // Toggle browser sessions accordion - memoized
  const handleToggleBrowserSessions = useCallback(() => {
    toggleAccordion('browserSessions');
  }, [toggleAccordion]);

  // Toggle RAG projects accordion - memoized
  const handleToggleRagProjects = useCallback(() => {
    toggleAccordion('ragProjects');
  }, [toggleAccordion]);

  // Handle RAG project indexing (force=true for full re-index) - memoized
  const handleIndexProject = useCallback(async (projectId, force = false) => {
    let url = '/api/rag/projects/' + projectId + '/index';
    if (force) {
      url = url + '?force=true';
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Failed to start indexing:', data.error);
      }
    } catch (error) {
      console.error('Failed to start indexing:', error);
    }
  }, []);

  // Handle file upload to RAG project via drag-and-drop - memoized
  const handleUploadToProject = useCallback(async (projectId, files) => {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    try {
      const res = await fetch(`/api/rag/projects/${projectId}/upload?index=true`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Failed to upload files:', data.error);
      } else {
        const data = await res.json();
        console.log('Upload successful:', data);
      }
    } catch (error) {
      console.error('Failed to upload files:', error);
    }
  }, []);

  // Get selected browser session object
  const selectedBrowserSession = browserSessions.find(
    (s) => s.id === selectedBrowserSessionId
  );

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

        {sidebarOpen && mode === MODES.EVAL && (
          <EvalSidebar
            onSelectEvaluation={handleSelectEvaluation}
            onSelectSuite={handleSelectSuite}
            onSelectResult={handleSelectResult}
            selectedEvaluation={selectedEvaluation}
            selectedSuite={selectedSuite}
            selectedResult={selectedResult}
          />
        )}

        {sidebarOpen && mode === MODES.CHAT && (
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
                className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''} ${conv.isWellKnown ? 'well-known' : ''} ${editingConversationId === conv.id ? 'editing' : ''}`}
                onClick={() => editingConversationId !== conv.id && handleSelectConversation(conv.id)}
              >
                <div className="conversation-info">
                  {editingConversationId === conv.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      className="conversation-rename-input"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={handleRenameKeyDown}
                      onBlur={handleSaveRename}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className="conversation-title">
                        {conv.icon && <span className="conversation-icon">{conv.icon}</span>}
                        {conv.title}
                      </div>
                      <div className="conversation-date">{formatDate(conv.updatedAt)}</div>
                    </>
                  )}
                </div>
                {/* Hide actions menu for well-known conversations */}
                {!conv.isWellKnown && (
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
                          className="actions-menu-item"
                          onClick={(e) => handleRenameConversation(conv.id, e)}
                        >
                          Rename
                        </button>
                        <button
                          className="actions-menu-item delete"
                          onClick={(e) => handleDeleteConversation(conv.id, e)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
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
                    agentTasks.map((task) => {
                      // Build tooltip content
                      const tooltipLines = [];
                      if (task.description) {
                        tooltipLines.push(task.description);
                      }
                      if (task.schedule) {
                        tooltipLines.push(`Schedule: ${task.schedule}`);
                      }
                      if (task.lastRun) {
                        tooltipLines.push(`Last run: ${new Date(task.lastRun).toLocaleString()}`);
                      }
                      const tooltip = tooltipLines.join('\n') || task.name;

                      // Format next run time
                      const formatNextRun = (nextRun) => {
                        if (!nextRun) return null;
                        const date = new Date(nextRun);
                        const now = new Date();
                        const diffMs = date - now;

                        // If in the past, show "Overdue"
                        if (diffMs < 0) return 'Overdue';

                        // If within 24 hours, show relative time
                        const diffHours = diffMs / (1000 * 60 * 60);
                        if (diffHours < 1) {
                          const diffMins = Math.round(diffMs / (1000 * 60));
                          return `in ${diffMins}m`;
                        }
                        if (diffHours < 24) {
                          return `in ${Math.round(diffHours)}h`;
                        }

                        // Otherwise show date
                        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                      };

                      const nextRunDisplay = formatNextRun(task.nextRun);

                      return (
                        <div key={task.id} className="accordion-item task-item" title={tooltip}>
                          <span className={`task-status ${task.status}`}>●</span>
                          <span className="task-name">{task.name}</span>
                          {nextRunDisplay && (
                            <span className="task-next-run">{nextRunDisplay}</span>
                          )}
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
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* RAG Projects Accordion */}
            <RAGProjects
              projects={ragProjects}
              indexingProgress={ragIndexingProgress}
              expanded={expandedAccordions.ragProjects}
              onToggle={handleToggleRagProjects}
              onIndex={handleIndexProject}
              onUpload={handleUploadToProject}
            />

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
                      {Object.entries(tools.mcp).map(([serverName, serverTools]) => {
                        const groupKey = 'mcp_' + serverName;
                        const isExpanded = expandedToolGroups[groupKey];
                        return (
                          <div key={serverName} className="tool-group">
                            <button
                              className={`tool-group-header ${isExpanded ? 'expanded' : ''}`}
                              onClick={() => setExpandedToolGroups(prev => {
                                const updated = { ...prev };
                                updated[groupKey] = !prev[groupKey];
                                return updated;
                              })}
                            >
                              <span className="tool-group-arrow">{isExpanded ? '▼' : '▶'}</span>
                              <span className="tool-group-icon">🔌</span>
                              <span className="tool-group-name">MCP: {serverName}</span>
                              <span className="tool-group-count">{serverTools.length}</span>
                            </button>
                            {isExpanded && (
                              <div className="tool-group-items">
                                {serverTools.map((tool) => (
                                  <div key={tool.name} className="tool-item" title={formatToolTooltip(tool)}>
                                    <span className="tool-name">{tool.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
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

            {/* Browser Sessions Accordion - always visible */}
            <BrowserSessions
              sessions={browserSessions}
              screenshots={browserScreenshots}
              selectedSessionId={selectedBrowserSessionId}
              onSelectSession={handleSelectBrowserSession}
              onCloseSession={handleCloseBrowserSession}
              expanded={expandedAccordions.browserSessions}
              onToggle={handleToggleBrowserSessions}
            />
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
              <span className="logo-icon">🐙</span>
              <h1>OllieBot</h1>
            </div>
            {/* Mode Switcher */}
            <div className="mode-switcher">
              <button
                className={`mode-btn ${mode === MODES.CHAT ? 'active' : ''}`}
                onClick={() => navigate('/chat')}
              >
                <span className="mode-icon">💬</span>
                Chat
              </button>
              <button
                className={`mode-btn ${mode === MODES.EVAL ? 'active' : ''}`}
                onClick={() => navigate('/eval')}
              >
                <span className="mode-icon">📊</span>
                Eval
              </button>
            </div>
          </div>
          <div className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </header>

        {/* Eval Mode Content */}
        {mode === MODES.EVAL && (
          <main className="eval-container">
            <EvalRunner
              evaluation={selectedEvaluation}
              suite={selectedSuite}
              viewingResults={viewingResults}
              onBack={handleEvalBack}
            />
          </main>
        )}

        {/* Chat Mode Content */}
        {mode === MODES.CHAT && (
        <>
        <main className="chat-container">
          <div className="messages" ref={messagesContainerRef} onScroll={handleScroll} onWheel={handleWheel}>
          {messages.length === 0 && (
            <div className="welcome">
              <h2>Welcome to OllieBot</h2>
              <p>Your personal support agent is ready to help.</p>
            </div>
          )}
          {messages.map((msg) =>
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
            ) : shouldCollapseByDefault(msg.agentType, msg.agentName) ? (
              // Collapsible agent message (e.g., research-worker)
              <div key={msg.id} className={`collapsible-agent-message ${expandedAgentMessages.has(msg.id) ? 'expanded' : 'collapsed'}`}>
                <div
                  className="collapsible-agent-header"
                  onClick={() => toggleAgentMessageExpand(msg.id)}
                >
                  <span className="collapsible-agent-icon">{msg.agentEmoji || '📚'}</span>
                  <span className="collapsible-agent-name">{msg.agentName || 'Agent'}</span>
                  <span className="collapsible-agent-preview">
                    {msg.content ? (msg.content.substring(0, 80) + (msg.content.length > 80 ? '...' : '')) : 'Processing...'}
                  </span>
                  <span className="collapsible-agent-expand-icon">
                    {expandedAgentMessages.has(msg.id) ? '▼' : '▶'}
                  </span>
                </div>
                {expandedAgentMessages.has(msg.id) && (
                  <div className={`message ${msg.role}${msg.isError ? ' error' : ''}${msg.isStreaming ? ' streaming' : ''}`}>
                    <div className="message-avatar">
                      {msg.isError ? '⚠️' : (msg.agentEmoji || '🐙')}
                    </div>
                    <div className="message-content">
                      <MessageContent content={msg.content} html={msg.html} isStreaming={msg.isStreaming} />
                      {msg.role === 'assistant' && msg.citations && !msg.isStreaming && (
                        <SourcePanel citations={msg.citations} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
            <div key={msg.id} className={`message ${msg.role}${msg.isError ? ' error' : ''}${msg.isStreaming ? ' streaming' : ''}`}>
              <div className="message-avatar">
                {msg.isError ? '⚠️' : msg.role === 'user' ? '👤' : (msg.agentEmoji || '🐙')}
              </div>
              <div className="message-content">
                {msg.agentName && msg.role === 'assistant' && (
                  <div className="agent-name">{msg.agentName}</div>
                )}
                <MessageContent content={msg.content} html={msg.html} isStreaming={msg.isStreaming} />
                {msg.role === 'assistant' && msg.citations && !msg.isStreaming && (
                  <SourcePanel citations={msg.citations} />
                )}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="message-attachments">
                    {msg.attachments.map((att, index) => (
                      <div key={index} className="message-attachment-chip">
                        <span className="attachment-icon">
                          {att.type?.startsWith('image/') ? '🖼️' : '📎'}
                        </span>
                        <span className="attachment-name" title={att.name}>
                          {att.name?.length > 25 ? att.name.slice(0, 22) + '...' : att.name}
                        </span>
                        <span className="attachment-size">
                          {formatFileSize(att.size)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {msg.messageType && (
                  <div className="message-reasoning-chip message-type-chip">
                    <span className="reasoning-chip-icon">🔬</span>
                    <span className="reasoning-chip-label">
                      {msg.messageType === 'deep_research' ? 'Deep Research' : msg.messageType}
                    </span>
                  </div>
                )}
                {msg.reasoningMode && (
                  <div className="message-reasoning-chip">
                    <span className="reasoning-chip-icon">🧠</span>
                    <span className="reasoning-chip-label">
                      {msg.reasoningMode === 'xhigh' ? 'Think+' : 'Think'}
                    </span>
                  </div>
                )}
                {msg.isStreaming && !msg.content && (
                  <span className="typing-indicator">
                    <span className="dot"></span>
                    <span className="dot"></span>
                    <span className="dot"></span>
                  </span>
                )}
                {msg.isStreaming && msg.content && (
                  <span className="streaming-cursor"></span>
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

        {/* Browser Preview Modal */}
        {selectedBrowserSession && (
          <BrowserPreview
            session={selectedBrowserSession}
            screenshot={browserScreenshots[selectedBrowserSessionId]}
            clickMarkers={clickMarkers}
            onClose={handleCloseBrowserPreview}
            onCloseSession={handleCloseBrowserSession}
          />
        )}
        </main>

        <footer
          className={`input-container ${isDragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <ChatInput
            ref={chatInputRef}
            onSubmit={handleSubmit}
            onPaste={handlePaste}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            isConnected={isConnected}
            isResponsePending={isResponsePending}
            reasoningMode={reasoningMode}
            messageType={messageType}
            onReasoningModeChange={setReasoningMode}
            onMessageTypeChange={setMessageType}
            modelCapabilities={modelCapabilities}
          />
        </footer>
        </>
        )}
      </div>
    </div>
  );
}

export default App;
