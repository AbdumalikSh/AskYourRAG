import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCircle2, ChevronDown,
  Command, FileQuestion, FileText, FolderOpen, HelpCircle, LoaderCircle, MessageSquare,
  MoreHorizontal, Plus, Search, Settings2, Sparkles, Upload, X, Zap,
} from 'lucide-react'
import './styles.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const SUGGESTIONS = [
  { icon: '◌', title: 'What are vector embeddings?', hint: 'Find the core idea across your PDFs.' },
  { icon: '↗', title: 'Summarize the key takeaways', hint: 'Pull together what matters most.' },
  { icon: '⌕', title: 'How does semantic search work?', hint: 'Explore a concept, with sources.' },
]

const HISTORY_KEY = 'folio-chat-history-v1'
const ACTIVE_CHAT_KEY = 'folio-active-chat-v1'

function readChatHistory() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch { return [] }
}

function newConversation(scopeFiles = null) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'New conversation',
    messages: [],
    scopeFiles,
    updatedAt: Date.now(),
  }
}

function ScopePicker({ documents, selectedFiles, onChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const indexedDocs = documents.filter(doc => doc.indexed)
  const checkedNames = selectedFiles === null
    ? indexedDocs.map(doc => doc.filename)
    : selectedFiles
  const scopeLabel = selectedFiles === null
    ? `All ${indexedDocs.length} ${indexedDocs.length === 1 ? 'PDF' : 'PDFs'}`
    : `${selectedFiles.length} selected`

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [])

  const toggle = (filename) => {
    const next = new Set(checkedNames)
    if (next.has(filename)) next.delete(filename)
    else next.add(filename)
    onChange(Array.from(next))
  }

  return <div className="scope-picker" ref={rootRef}>
    <button className={`scope-trigger ${open ? 'is-open' : ''}`} type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Document scope: ${scopeLabel}`}>
      <FileText size={12}/><span>{scopeLabel}</span><ChevronDown size={12}/>
    </button>
    {open && <div className="scope-menu">
      <div className="scope-menu-head"><span>SEARCH IN</span><button type="button" onClick={() => { onChange(null); setOpen(false) }}>All PDFs</button></div>
      {documents.length ? <div className="scope-options">{documents.map(doc => {
        const checked = checkedNames.includes(doc.filename)
        return <button className={`scope-option ${!doc.indexed ? 'is-disabled' : ''}`} type="button" key={doc.filename} disabled={!doc.indexed} onClick={() => toggle(doc.filename)}>
          <span className={`scope-checkbox ${checked ? 'checked' : ''}`}>{checked && <Check size={11}/>}</span>
          <span className="scope-file-name" title={doc.filename}>{doc.filename}</span>
          <span className="scope-file-state">{doc.indexed ? `${doc.pages} ${doc.pages === 1 ? 'page' : 'pages'}` : 'Not indexed'}</span>
        </button>
      })}</div> : <div className="scope-empty">Add PDFs to choose a search scope.</div>}
      <div className="scope-menu-foot">Only selected PDFs will be searched.</div>
    </div>}
  </div>
}

function App() {
  const [documents, setDocuments] = useState([])
  const [conversations, setConversations] = useState(readChatHistory)
  const [activeConversationId, setActiveConversationId] = useState(() => {
    try {
      const savedId = sessionStorage.getItem(ACTIVE_CHAT_KEY)
      if (savedId && conversations.some(chat => chat.id === savedId)) return savedId
    } catch { /* session storage may be unavailable */ }
    return conversations[0]?.id || null
  })
  const [draftScopeFiles, setDraftScopeFiles] = useState(null)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [apiOnline, setApiOnline] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [showAllDocs, setShowAllDocs] = useState(false)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const chatEndRef = useRef(null)
  const activeConversation = conversations.find(chat => chat.id === activeConversationId)
  const messages = activeConversation?.messages || []
  const scopeFiles = activeConversation ? activeConversation.scopeFiles : draftScopeFiles

  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(conversations))
      if (activeConversationId) sessionStorage.setItem(ACTIVE_CHAT_KEY, activeConversationId)
      else sessionStorage.removeItem(ACTIVE_CHAT_KEY)
    } catch { /* chat history remains available in memory for this page */ }
  }, [conversations, activeConversationId])

  const refreshDocuments = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/documents`)
      if (!response.ok) throw new Error('API unavailable')
      const data = await response.json()
      setDocuments(data.documents || [])
      setApiOnline(true)
      return true
    } catch { setApiOnline(false); return false }
  }, [])

  useEffect(() => {
    let timer
    let attempts = 0
    let cancelled = false
    const loadDocuments = async () => {
      const loaded = await refreshDocuments()
      if (!loaded && !cancelled && attempts++ < 5) timer = setTimeout(loadDocuments, 1500)
    }
    loadDocuments()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [refreshDocuments])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const appendMessage = (conversationId, message) => {
    setConversations(prev => prev.map(chat => {
      if (chat.id !== conversationId) return chat
      const title = chat.title === 'New conversation' && message.role === 'user'
        ? message.text.replace(/\s+/g, ' ').trim().slice(0, 42) || 'New conversation'
        : chat.title
      return { ...chat, title, messages: [...chat.messages, message], updatedAt: Date.now() }
    }).sort((a, b) => b.updatedAt - a.updatedAt))
  }

  const startNewChat = () => {
    const chat = newConversation()
    setConversations(prev => [chat, ...prev])
    setActiveConversationId(chat.id)
    setDraftScopeFiles(null)
    setQuestion('')
    setError('')
    inputRef.current?.focus()
  }

  const openChat = (conversationId) => {
    setActiveConversationId(conversationId)
    setConversations(prev => prev.map(chat => chat.id === conversationId ? { ...chat, updatedAt: Date.now() } : chat).sort((a, b) => b.updatedAt - a.updatedAt))
    setQuestion('')
    setError('')
  }

  const changeScopeFiles = (nextFiles) => {
    if (!activeConversationId) {
      setDraftScopeFiles(nextFiles)
      return
    }
    setConversations(prev => prev.map(chat => chat.id === activeConversationId ? { ...chat, scopeFiles: nextFiles, updatedAt: Date.now() } : chat))
  }

  const addFiles = async (files) => {
    const pdfs = Array.from(files || []).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) { setError('Please choose a PDF file.'); return }
    setUploading(true); setError('')
    const data = new FormData()
    pdfs.forEach(f => data.append('files', f))
    try {
      const response = await fetch(`${API}/api/ingest`, { method: 'POST', body: data })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to index these PDFs.')
      await refreshDocuments()
      if (activeConversationId) appendMessage(activeConversationId, { role: 'system', text: `${pdfs.length} ${pdfs.length === 1 ? 'document' : 'documents'} indexed · ${result.chunks} passages ready to search.` })
    } catch (err) { setError(err.message || 'Could not connect to the API. Start the backend and try again.') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const ask = async (text = question) => {
    const q = text.trim()
    if (!q || loading) return
    setQuestion(''); setError('')
    let conversationId = activeConversationId
    if (!conversationId) {
      const chat = newConversation(scopeFiles)
      conversationId = chat.id
      setConversations(prev => [chat, ...prev])
      setActiveConversationId(conversationId)
      setDraftScopeFiles(null)
    }
    appendMessage(conversationId, { role: 'user', text: q })
    setLoading(true)
    try {
      const response = await fetch(`${API}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, top_k: 5, filenames: scopeFiles }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Could not answer this question.')
      appendMessage(conversationId, { role: 'assistant', text: result.answer, sources: result.sources || [] })
    } catch (err) { appendMessage(conversationId, { role: 'error', text: err.message || 'Could not connect to the API.' }) }
    finally { setLoading(false); inputRef.current?.focus() }
  }

  const onSubmit = (e) => { e.preventDefault(); ask() }
  const shownDocs = showAllDocs ? documents : documents.slice(0, 5)
  const indexedCount = documents.filter(d => d.indexed).length

  return <main className="app-shell" onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }} onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={16} strokeWidth={2.1}/></div><span>Unicorn Finder</span><span className="brand-version">workspace</span></div>
      <div className="sidebar-main">
        <button className="new-chat" onClick={startNewChat}><Plus size={16}/><span>New conversation</span><span className="shortcut"><Command size={11}/> K</span></button>
        <div className="nav-label">YOUR WORKSPACE</div>
        <button className="nav-item selected"><MessageSquare size={15}/><span>Ask your documents</span></button>
        <div className="history-section"><div className="section-heading history-heading"><span>RECENT CHATS</span><span className="session-label">THIS SESSION</span></div>
          {conversations.length ? <div className="history-list">{conversations.map(chat => <button className={`history-item ${chat.id === activeConversationId ? 'active' : ''}`} key={chat.id} onClick={() => openChat(chat.id)} title={chat.title}><MessageSquare size={13}/><span>{chat.title}</span></button>)}</div> : <div className="history-empty">Your chats will appear here.</div>}
        </div>
        <div className="section-heading"><span>YOUR LIBRARY</span><button className="icon-button small" aria-label="Add documents" onClick={() => fileRef.current?.click()}><Plus size={15}/></button></div>
        {documents.length ? <div className="doc-list">{shownDocs.map(doc => <div className="doc-item" key={doc.filename}><div className={`doc-icon ${doc.indexed ? '' : 'pending'}`}><FileText size={14}/></div><div className="doc-meta"><span className="doc-name" title={doc.filename}>{doc.filename}</span><span className="doc-pages">{doc.indexed ? `${doc.pages} ${doc.pages === 1 ? 'page' : 'pages'} · indexed` : 'Needs indexing'}</span></div><MoreHorizontal size={15} className="doc-more"/></div>)}
          {documents.length > 5 && <button className="view-all" onClick={() => setShowAllDocs(!showAllDocs)}>{showAllDocs ? 'Show less' : `View all ${documents.length} documents`}<ChevronDown size={13} className={showAllDocs ? 'flip' : ''}/></button>}</div> : <button className="empty-library" onClick={() => fileRef.current?.click()}><FolderOpen size={16}/><span>No documents yet</span><ArrowRight size={13}/></button>}
        <button className="add-docs" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <LoaderCircle size={14} className="spin"/> : <Plus size={14}/>}<span>{uploading ? 'Indexing PDFs…' : 'Add documents'}</span></button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e => addFiles(e.target.files)}/>
        <div className="sidebar-note"><div className="note-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span>✳</span></div><p>Your research, all in one place.</p><span>Ask anything across your PDFs.</span></div>
      </div>
      <div className="sidebar-footer"><div className="profile"><div className="avatar">A</div><div className="profile-copy"><span>Your workspace</span><span>Personal library</span></div><Settings2 size={15} className="profile-settings"/></div></div>
    </aside>

    <section className="main-panel">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><span className="crumb-current">Ask your documents</span></div><div className="topbar-right"><div className={`connection ${apiOnline ? 'online' : ''}`}><span className="status-dot"/>{apiOnline ? 'Connected' : 'Offline'}</div><button className="help-button" aria-label="Help"><HelpCircle size={17}/></button></div></header>

      <div className="work-area">
        {messages.length === 0 ? <div className="welcome-wrap">
          <div className="welcome-kicker"><span className="kicker-dot"/>YOUR PRIVATE RESEARCH SPACE</div>
          <h1>Good questions<br/>deserve <em>good sources.</em></h1>
          <p className="welcome-sub">Have a conversation with your PDFs. Get clear answers,<br className="desktop-break"/> grounded in the pages that matter.</p>
          <div className="composer-wrap welcome-composer">
            <form className="composer" onSubmit={onSubmit}>
              <textarea ref={inputRef} rows="1" placeholder={documents.length ? 'Ask anything about your documents…' : 'Add a PDF to start exploring…'} value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }} />
              <div className="composer-bottom"><div className="compose-tools"><span className="input-hint"><Sparkles size={12}/>Answers with page-level citations</span><ScopePicker documents={documents} selectedFiles={scopeFiles} onChange={changeScopeFiles}/></div><button className="send-button" type="submit" disabled={!question.trim() || loading} aria-label="Send question"><ArrowUp size={16}/></button></div>
            </form>
            <div className="composer-foot"><span><kbd>↵</kbd> to ask <span className="hint-divider">·</span> <kbd>⇧ ↵</kbd> for a new line</span><span><span className="privacy-dot"/>Your files stay in your workspace</span></div>
          </div>
          {error && <div className="error-banner"><X size={14}/>{error}</div>}
          <div className="suggestions-head"><span>START WITH A QUESTION</span><span>THREE IDEAS <ArrowDown size={11}/></span></div>
          <div className="suggestions">{SUGGESTIONS.map((s, i) => <button key={s.title} className="suggestion" onClick={() => ask(s.title)}><span className={`suggestion-glyph glyph-${i}`}>{s.icon}</span><span className="suggestion-copy"><strong>{s.title}</strong><small>{s.hint}</small></span><ArrowRight size={15} className="suggestion-arrow"/></button>)}</div>
          <div className="welcome-bottom"><span><span className="bottom-shape">⌘</span> Grounded in your sources, always.</span><span>{documents.length ? `${indexedCount} ${indexedCount === 1 ? 'document' : 'documents'} indexed` : 'Add a PDF to begin'}<span className="bottom-separator">·</span><button onClick={() => fileRef.current?.click()}>Browse files <ArrowRight size={11}/></button></span></div>
        </div> : <div className="chat-view">
          <div className="chat-heading"><div className="chat-heading-text"><span className="eyebrow">YOUR RESEARCH SESSION</span><h2>Ask your documents<span className="live-pip"/></h2><p>{indexedCount} {indexedCount === 1 ? 'document' : 'documents'} in this conversation</p></div><button className="chat-add" onClick={() => fileRef.current?.click()}><Plus size={14}/> Add PDFs</button></div>
          <div className="messages">{messages.map((m, i) => m.role === 'system' ? <div className="system-line" key={i}><CheckCircle2 size={14}/>{m.text}</div> : m.role === 'user' ? <div className="user-row" key={i}><div className="user-bubble">{m.text}</div></div> : <article className={`answer-card ${m.role === 'error' ? 'answer-error' : ''}`} key={i}><div className="answer-label"><div className="answer-icon"><Sparkles size={13}/></div><span>Unicorn Finder</span><span className="answer-dot"/><span className="answer-label-note">ANSWER</span></div><div className="answer-text">{m.text}</div>{m.sources?.length > 0 && <div className="sources"><div className="sources-title"><span>GROUNDED IN</span><span>{m.sources.length} {m.sources.length === 1 ? 'SOURCE' : 'SOURCES'}</span></div><div className="source-list">{m.sources.map((source, idx) => <div className="source-card" key={`${source.filename}-${source.page}-${idx}`}><div className="source-file-icon"><FileText size={14}/></div><div className="source-info"><strong>{source.filename}</strong><span>Page {source.page} <span className="source-sep">·</span> relevance {Math.round(source.score * 100)}%</span></div><span className="source-page">p. {source.page}</span></div>)}</div></div>}</article>)}
            {loading && <article className="answer-card loading-card"><div className="answer-label"><div className="answer-icon"><Sparkles size={13}/></div><span>Unicorn Finder</span><span className="answer-dot"/><span className="answer-label-note">THINKING</span><LoaderCircle size={13} className="spin thinking-spin"/></div><div className="thinking-copy"><span/><span/><span/></div></article>}<div ref={chatEndRef}/>
          </div>
          <div className="chat-compose-wrap"><div className="composer-wrap"><form className="composer chat-composer" onSubmit={onSubmit}><textarea ref={inputRef} rows="1" placeholder="Ask a follow-up question…" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}/><div className="composer-bottom"><div className="compose-tools"><span className="input-hint"><Sparkles size={12}/>Answers with page-level citations</span><ScopePicker documents={documents} selectedFiles={scopeFiles} onChange={changeScopeFiles}/></div><button className="send-button" type="submit" disabled={!question.trim() || loading} aria-label="Send question"><ArrowUp size={16}/></button></div></form><div className="composer-foot"><span>Answers are generated from your selected PDFs</span><span><span className="privacy-dot"/>Private workspace</span></div></div></div>
        </div>}
      </div>
      <footer className="main-footer"><span><span className="footer-mark">✳</span> UNICORN FINDER <span className="footer-divider">/</span> A QUIETER WAY TO FIND THE ANSWER</span><span><span className="footer-dot"/>Private by design</span></footer>
    </section>
    {dragging && <div className="drop-overlay"><div className="drop-card"><div className="drop-icon"><Upload size={24}/></div><strong>Drop your PDFs here</strong><span>They’ll be indexed and ready to search.</span></div></div>}
    <div className="toast-error" aria-live="polite">{error}</div>
  </main>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
