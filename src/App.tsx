import { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { LANGUAGES, REGIONS } from './constants';
import { cn } from './lib/utils';
import {
  Globe,
  Languages,
  Wand2,
  Download,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Search,
  Filter,
  CheckSquare,
  Square,
  Loader2,
  Trash2,
  Sparkles,
  AlertTriangle,
  Sun,
  Moon
} from 'lucide-react';

const YouTubeLogo = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" className={className}>
    <path fill="#ff0033" d="M549.7 124.1c-6.3-23.7-24.8-42.3-48.3-48.6C458.8 64 288 64 288 64S117.2 64 74.6 75.5c-23.5 6.3-42 24.9-48.3 48.6-11.4 42.9-11.4 132.3-11.4 132.3s0 89.4 11.4 132.3c6.3 23.7 24.8 41.5 48.3 47.8C117.2 448 288 448 288 448s170.8 0 213.4-11.5c23.5-6.3 42-24.2 48.3-47.8 11.4-42.9 11.4-132.3 11.4-132.3s0-89.4-11.4-132.3zm-317.5 213.5V175.2l142.7 81.2-142.7 81.2z"/>
  </svg>
);

interface TranslationResult {
  language: string;
  title: string;
  description: string;
  status: 'pending' | 'success' | 'error' | 'retrying';
}

export default function App() {
  const [isDark, setIsDark] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [protectedTerms, setProtectedTerms] = useState('');
  
  const [searchLang, setSearchLang] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<string>('All');
  const [selectedLangs, setSelectedLangs] = useState<Set<string>>(new Set());
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [results, setResults] = useState<TranslationResult[]>([]);
  const [globalError, setGlobalError] = useState<string>('');
  const [waitMessage, setWaitMessage] = useState<string>('');

  const delayWithCountdown = async (ms: number, baseMsg: string = 'Waiting') => {
    let secondsLeft = Math.ceil(ms / 1000);
    setWaitMessage(`${baseMsg}. Resuming in ${secondsLeft}s...`);
    
    return new Promise<void>(resolve => {
       const interval = setInterval(() => {
          secondsLeft--;
          if (secondsLeft <= 0) {
             clearInterval(interval);
             setWaitMessage('');
             resolve();
          } else {
             setWaitMessage(`${baseMsg}. Resuming in ${secondsLeft}s...`);
          }
       }, 1000);
    });
  }

  const filteredLangs = useMemo(() => {
    let list = LANGUAGES;
    if (selectedRegion !== 'All') {
      list = REGIONS[selectedRegion] || [];
    }
    if (searchLang) {
      const searchTerms = searchLang.toLowerCase().split(/[\s,]+/).filter(Boolean);
      if (searchTerms.length > 0) {
        list = list.filter(l => {
          const lowerL = l.toLowerCase();
          return searchTerms.some(term => lowerL.includes(term));
        });
      }
    }
    return list;
  }, [searchLang, selectedRegion]);

  const handleSelectAll = () => {
    if (selectedLangs.size === filteredLangs.length) {
      setSelectedLangs(new Set());
    } else {
      setSelectedLangs(new Set(filteredLangs));
    }
  };

  const toggleLang = (lang: string) => {
    const newSet = new Set(selectedLangs);
    if (newSet.has(lang)) {
      newSet.delete(lang);
    } else {
      newSet.add(lang);
    }
    setSelectedLangs(newSet);
  };

  const translateBatch = async (languages: string[], sourceTitle: string, sourceDesc: string, terms: string, attempt = 1): Promise<any[]> => {
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: sourceTitle,
          description: sourceDesc,
          protectedTerms: terms,
          languages,
          apiKey
        })
      });
      if ((res.status === 429 || res.status === 503) && attempt <= 6) {
        const retryAfter = res.headers.get('Retry-After');
        let delayMs = retryAfter ? parseInt(retryAfter) * 1000 : attempt * 10000;
        if (isNaN(delayMs) || delayMs <= 0) delayMs = attempt * 10000;
        await delayWithCountdown(delayMs + 2000, 'Rate limit paused');
        return translateBatch(languages, sourceTitle, sourceDesc, terms, attempt + 1);
      }
      if (!res.ok) {
         const err = await res.json().catch(() => ({}));
         throw new Error(err.error || "Failed");
      }
      const data = await res.json();
      return data.translations || [];
    } catch (e: any) {
      if (attempt <= 3) {
         await delayWithCountdown(attempt * 5000, 'Error retrying');
         return translateBatch(languages, sourceTitle, sourceDesc, terms, attempt + 1);
      }
      throw e;
    }
  };

  const handleTranslate = async () => {
    if (!title || !description) {
      alert("Please enter both title and description.");
      return;
    }
    if (selectedLangs.size === 0) {
      alert("Please select at least one language.");
      return;
    }

    setIsTranslating(true);
    setGlobalError('');
    const langsArray: string[] = Array.from(selectedLangs);
    const initialResults: TranslationResult[] = langsArray.map((lang: string) => ({
      language: lang,
      title: '',
      description: '',
      status: 'pending'
    }));
    setResults(initialResults);

    // Batch chunk languages (15 languages per API call) to optimize quota usage
    const chunkSize = 15;
    for (let i = 0; i < langsArray.length; i += chunkSize) {
      const chunk = langsArray.slice(i, i + chunkSize);
      
      try {
        const batchResults = await translateBatch(chunk, title, description, protectedTerms);
        
        setResults(prev => prev.map(r => {
           if (chunk.includes(r.language)) {
              const matched = batchResults.find((b: any) => b.language === r.language);
              if (matched) {
                 return { ...r, title: matched.title || '', description: matched.description || '', status: 'success' };
              }
              return { ...r, status: 'error' };
           }
           return r;
        }));
      } catch (err: any) {
        if (err.message) {
           setGlobalError(err.message);
        }
        setResults(prev => prev.map(r => {
           if (chunk.includes(r.language) && r.status === 'pending') return { ...r, status: 'error' };
           return r;
        }));
      }
      
      // Delay to respect rate limits (5 seconds between batches for safer quota management)
      if (i + chunkSize < langsArray.length) {
        await delayWithCountdown(5000, 'Pacing to avoid rate limits');
      }
    }

    setIsTranslating(false);
  };

  const translateBatchRetry = async (titlesToRetry: { language: string, title: string }[], terms: string, attempt = 1): Promise<any[]> => {
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protectedTerms: terms,
          titlesToRetry,
          apiKey
        })
      });
      if ((res.status === 429 || res.status === 503) && attempt <= 6) {
        const retryAfter = res.headers.get('Retry-After');
        let delayMs = retryAfter ? parseInt(retryAfter) * 1000 : attempt * 15000;
        if (isNaN(delayMs) || delayMs <= 0) delayMs = attempt * 15000;
        await delayWithCountdown(delayMs + 2000, 'Rate limit paused');
        return translateBatchRetry(titlesToRetry, terms, attempt + 1);
      }
      if (!res.ok) {
         const err = await res.json().catch(() => ({}));
         throw new Error(err.error || "Failed");
      }
      const data = await res.json();
      return data.shortenedTitles || [];
    } catch (e: any) {
      if (attempt <= 3) {
         await delayWithCountdown(attempt * 10000, 'Error retrying');
         return translateBatchRetry(titlesToRetry, terms, attempt + 1);
      }
      throw e;
    }
  };

  const handleBatchRefine = async () => {
    const toRetry = results.filter(r => Array.from(r.title || '').length > 100 && (r.status === 'success' || r.status === 'error'));
    if (toRetry.length === 0) return;

    setIsTranslating(true);
    setGlobalError('');
    setResults(prev => prev.map(r => {
      const needsRetry = toRetry.find(tr => tr.language === r.language);
      return needsRetry ? { ...r, status: 'retrying' } : r;
    }));

    // Batch retries in chunks of 15
    const batchSize = 15;
    for (let i = 0; i < toRetry.length; i += batchSize) {
      const chunk = toRetry.slice(i, i + batchSize).map(r => ({ language: r.language, title: r.title }));
      try {
        const batchResults = await translateBatchRetry(chunk, protectedTerms);
        setResults(prev => prev.map(r => {
          const matched = batchResults.find((b: any) => b.language === r.language);
          if (matched) {
            return { ...r, title: matched.title, status: 'success' };
          }
          return r;
        }));
      } catch (err: any) {
        if (err.message) {
           setGlobalError(err.message);
        }
        setResults(prev => prev.map(r => {
          if (chunk.find(c => c.language === r.language)) return { ...r, status: 'error' };
          return r;
        }));
      }
      if (i + batchSize < toRetry.length) await delayWithCountdown(5000, 'Pacing to avoid rate limits');
    }
    setIsTranslating(false);
  };

  const handleRetryTitle = async (idx: number) => {
    const item = results[idx];
    if (!item) return;

    setResults(prev => prev.map((r, i) => i === idx ? { ...r, status: 'retrying' } : r));
    
    try {
      const res = await translateBatchRetry([{ language: item.language, title: item.title }], protectedTerms);
      if (res && res.length > 0) {
        setResults(prev => prev.map((r, i) => i === idx ? {
          ...r,
          title: res[0].title,
          status: 'success'
        } : r));
      } else {
        throw new Error("Failed");
      }
    } catch (e: any) {
      if (e.message) {
         setGlobalError(e.message);
      }
      setResults(prev => prev.map((r, i) => i === idx ? { ...r, status: 'error' } : r));
    }
  };

  const exportCSV = () => {
    if (results.length === 0) return;
    const header = ["Language", "Title", "Description"];
    const rows = results.map(r => [r.language, r.title, r.description]);
    const csvContent = [
      header.join(","),
      ...rows.map(e => e.map(field => `"${(field || '').toString().replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "translations.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportXLSX = () => {
    if (results.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(results.map(r => ({
      Language: r.language,
      Title: r.title,
      Description: r.description
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Translations");
    XLSX.writeFile(workbook, "translations.xlsx");
  };

  const getTitleColor = (title: string, status: string) => {
    if (status === 'pending' || status === 'retrying') return 'text-gray-400';
    if (!title) return 'text-gray-400';
    const len = Array.from(title).length; // Accounts for emojis nicely
    if (len <= 80) return 'text-green-600 bg-green-50 outline-green-200';
    if (len <= 100) return 'text-yellow-600 bg-yellow-50 outline-yellow-200';
    return 'text-red-600 bg-red-50 outline-red-200';
  };

  return (
    <div className={cn("flex flex-col h-screen w-full font-sans overflow-hidden selection:bg-[#1e81c0]/20", isDark ? "dark" : "")}>
      <div className="flex flex-col h-full w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Header Section */}
      <header className="h-16 flex items-center justify-between px-8 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm shrink-0 transition-colors">
        <div className="flex items-center gap-3">
          <YouTubeLogo className="w-8 h-8 drop-shadow-sm" />
          <h1 className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
            <span className="text-[#1e81c0]">WA</span><span className="text-[#f99422]">UP</span>{' '}
            Smart <span className="text-[#ff0033]">YouTube</span> Translator
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsDark(!isDark)}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            onClick={exportCSV}
            disabled={results.length === 0 || isTranslating}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={exportXLSX}
            disabled={results.length === 0 || isTranslating}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Export Excel
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        
        {/* Left Sidebar: Configuration */}
        <aside className="w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col p-5 overflow-hidden shrink-0 z-10 shadow-sm transition-colors">
          <div className="mb-4 shrink-0">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
               <span>Gemini API Key</span>
               <span className="text-[9px] font-normal opacity-70 normal-case bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Optional</span>
            </label>
            <input
              type="password"
              className="w-full p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-[#1e81c0] outline-none transition-colors"
              placeholder="Leave blank for default key"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
            />
          </div>

          <div className="mb-6 shrink-0">
            <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Protected Terms</label>
            <textarea
              className="w-full h-24 p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-[#1e81c0] outline-none resize-none custom-scrollbar transition-colors"
              placeholder="e.g. LinusTechTips, #shorts, RTX 4090..."
              value={protectedTerms}
              onChange={e => setProtectedTerms(e.target.value)}
            />
            <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-500 italic">These terms will remain untranslated in all versions.</p>
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Target Languages</label>
              <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full">{selectedLangs.size}/{LANGUAGES.length}</span>
            </div>
            
            <div className="relative mb-2 shrink-0">
              <input
                type="text"
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded text-xs focus:ring-2 focus:ring-[#1e81c0] outline-none transition-colors"
                placeholder="Search languages (e.g. French, German)..."
                value={searchLang}
                onChange={e => setSearchLang(e.target.value)}
              />
              <Search className="w-3 h-3 absolute left-2.5 top-2.5 text-slate-400 dark:text-slate-500" />
            </div>

            <div className="relative mb-3 shrink-0">
               <select
                 value={selectedRegion}
                 onChange={e => setSelectedRegion(e.target.value)}
                 className="w-full pl-8 pr-6 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded focus:ring-2 focus:ring-[#1e81c0] outline-none appearance-none cursor-pointer transition-colors"
               >
                 <option value="All">All Regions</option>
                 {Object.keys(REGIONS).map(r => <option key={r} value={r}>{r}</option>)}
               </select>
               <Filter className="w-3 h-3 absolute left-2.5 top-2.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
            </div>

            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <button
                onClick={handleSelectAll}
                className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
              >
                {selectedLangs.size === filteredLangs.length && filteredLangs.length > 0 ? (
                  <CheckSquare className="w-4 h-4 text-[#1e81c0]" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                Select All matching
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
              {filteredLangs.map(lang => (
                <label
                  key={lang}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded cursor-pointer transition-all",
                    selectedLangs.has(lang)
                      ? "bg-[#1e81c0]/10 text-[#1e81c0] border border-[#1e81c0]/20"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-600 dark:text-slate-400 border border-transparent"
                  )}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={selectedLangs.has(lang)}
                    onChange={() => toggleLang(lang)}
                  />
                  {selectedLangs.has(lang) ? (
                     <CheckSquare className="w-4 h-4 text-[#1e81c0] shrink-0" />
                  ) : (
                     <Square className="w-4 h-4 opacity-50 shrink-0" />
                  )}
                  <span className="text-xs font-medium truncate">{lang}</span>
                </label>
              ))}
              {filteredLangs.length === 0 && (
                <div className="text-center text-slate-500 text-xs py-4">No languages found</div>
              )}
            </div>
          </div>
        </aside>

        {/* Center: Content Input */}
        <section className="flex-1 flex flex-col p-6 space-y-4 overflow-y-auto min-w-0 custom-scrollbar">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 shrink-0 transition-colors">
            <div className="flex justify-between items-center mb-3">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Original Title (EN)</label>
              <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{Array.from(title).length}/100</span>
            </div>
            <input
              type="text"
              className="w-full p-4 border border-slate-200 dark:border-slate-800 rounded-lg text-lg font-semibold text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-950 focus:border-[#1e81c0] dark:focus:border-[#1e81c0] outline-none transition-colors shadow-inner"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Building the Ultimate 4K Editing Rig #SetupWars"
            />
          </div>

          <div className="flex-1 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 flex flex-col min-h-[300px] transition-colors">
            <div className="flex justify-between items-center mb-3">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Original Description (EN)</label>
              <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{Array.from(description).length} chars</span>
            </div>
            <textarea
              className="flex-1 w-full p-4 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 focus:border-[#1e81c0] dark:focus:border-[#1e81c0] outline-none resize-none leading-relaxed overflow-y-auto custom-scrollbar shadow-inner transition-colors"
              placeholder="Enter your video description here..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <button
            onClick={handleTranslate}
            disabled={isTranslating || selectedLangs.size === 0 || !title || !description}
            className="w-full py-4 bg-[#1e81c0] text-white rounded-lg text-sm font-bold shadow-md hover:bg-[#156a9e] disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed transition-all shrink-0 flex items-center justify-center gap-2"
          >
            {isTranslating ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Translating...</>
            ) : (
              <><Wand2 className="w-5 h-5" /> Translate to {selectedLangs.size > 0 ? selectedLangs.size : '...'} languages</>
            )}
          </button>
        </section>

        {/* Right: Translation Results Preview */}
        <section className="w-[400px] bg-slate-100 dark:bg-slate-900/50 border-l border-slate-200 dark:border-slate-800 flex flex-col shrink-0 z-10 relative transition-colors">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between shrink-0 transition-colors">
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Live Translation Stream</h3>
              {results.filter(r => Array.from(r.title || '').length > 100).length > 0 && (
                <button 
                  onClick={handleBatchRefine}
                  disabled={isTranslating}
                  className="text-[10px] font-bold text-[#f99422] hover:text-[#db7a11] underline underline-offset-2 flex items-center gap-1 mt-0.5 disabled:opacity-50 transition-colors"
                >
                  <Sparkles className="w-3 h-3" /> Refine All Long Titles
                </button>
              )}
            </div>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{results.filter(r => r.status === 'success' || r.status === 'error').length} / {results.length}</span>
          </div>

          {globalError && (
             <div className="absolute top-0 left-0 right-0 z-20 m-2 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-400 text-xs rounded shadow-sm flex items-start justify-between backdrop-blur-sm">
                <div>
                   <strong className="block mb-1">API Error</strong>
                   {globalError}
                </div>
                <button onClick={() => setGlobalError('')} className="text-red-500 hover:text-red-700 font-bold ml-2">×</button>
             </div>
          )}

          {waitMessage && (
             <div className="absolute top-0 left-0 right-0 z-20 m-2 p-3 bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-400 text-xs rounded shadow-sm flex items-center justify-between shadow-blue-500/10 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                   <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
                   <span className="font-medium">{waitMessage}</span>
                </div>
             </div>
          )}
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
             {results.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 opacity-70">
                 <Globe className="w-12 h-12 mb-4" />
                 <h3 className="text-sm font-bold">Waiting for input</h3>
                 <p className="text-xs text-center max-w-[200px] mt-1">Translations will stream here.</p>
               </div>
             ) : (
                results.map((result, idx) => {
                  const len = Array.from(result.title || '').length;
                  let cardClass = "";
                  let badgeWrapClass = "";
                  let badgeTextClass = "";

                  if (result.status === 'pending' || result.status === 'retrying') {
                    cardClass = "border-slate-200 dark:border-slate-700 border-l-slate-400 opacity-80";
                    badgeWrapClass = "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400";
                    badgeTextClass = "text-slate-600 dark:text-slate-400";
                  } else if (result.status === 'error' || len > 100) {
                    cardClass = "border-red-200 dark:border-red-900/50 border-l-red-500 bg-red-50/10 dark:bg-red-900/10";
                    badgeWrapClass = "bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-400";
                    badgeTextClass = "text-red-600 dark:text-red-400";
                  } else if (len <= 80) {
                    cardClass = "border-emerald-200 dark:border-emerald-900/50 border-l-emerald-500 bg-emerald-50/10 dark:bg-emerald-900/10";
                    badgeWrapClass = "bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400";
                    badgeTextClass = "text-emerald-600 dark:text-emerald-400";
                  } else {
                    cardClass = "border-amber-200 dark:border-amber-900/50 border-l-amber-500 bg-amber-50/10 dark:bg-amber-900/10";
                    badgeWrapClass = "bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400";
                    badgeTextClass = "text-amber-600 dark:text-amber-400";
                  }

                  return (
                    <div key={idx} className={cn("bg-white dark:bg-slate-900 border rounded-lg shadow-sm p-4 border-l-4 transition-all", cardClass)}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-tighter flex items-center gap-1", badgeWrapClass)}>
                          {result.status === 'pending' || result.status === 'retrying' ? <Loader2 className="w-3 h-3 animate-spin"/> : null} 
                          {result.language}
                        </span>
                        {result.title && <span className={cn("text-xs font-mono font-bold", badgeTextClass)}>{len}/100</span>}
                      </div>
                      
                      {result.status === 'pending' || result.status === 'retrying' ? (
                        <div className="space-y-2 mb-2">
                           <div className="h-4 bg-slate-100 dark:bg-slate-800 animate-pulse rounded w-full" />
                           <div className="h-4 bg-slate-100 dark:bg-slate-800 animate-pulse rounded w-3/4" />
                        </div>
                      ) : (
                        <h4 className={cn("text-sm font-bold text-slate-800 dark:text-slate-200 mb-2", !result.title && "italic text-red-500 dark:text-red-400")}>
                          {result.title || "Translation failed."}
                        </h4>
                      )}

                      {/* AI Refine button for over-limit */}
                      {len > 100 && (result.status === 'success' || result.status === 'error') && (
                        <>
                          <div className="mt-2 mb-3 p-2 bg-red-50 dark:bg-red-900/30 rounded text-[11px] text-red-700 dark:text-red-400 flex gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            Title exceeds limit. Click AI Refine.
                          </div>
                          <button 
                            onClick={() => handleRetryTitle(idx)}
                            className="w-full py-2 bg-[#f99422] text-white rounded text-xs font-bold shadow-sm hover:bg-[#db7a11] flex items-center justify-center gap-1 transition-colors"
                          >
                            <RefreshCw className="w-3 h-3" /> AI Refine (Keep Hook)
                          </button>
                        </>
                      )}

                      {/* Description preview */}
                      {!(result.status === 'pending' || result.status === 'retrying') && result.description && (
                        <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-2 rounded border border-slate-100 dark:border-slate-800 line-clamp-2 hover:line-clamp-none transition-all cursor-pointer" title="Click to expand">
                           {result.description}
                        </div>
                      )}
                    </div>
                  );
                })
             )}
          </div>
        </section>
      </main>

      {/* Footer Bar */}
      <footer className="h-8 bg-slate-800 dark:bg-slate-950 text-slate-400 dark:text-slate-500 px-6 flex items-center justify-between text-[10px] uppercase tracking-widest shrink-0 relative z-20 border-t border-slate-700 dark:border-slate-900">
        <div className="flex items-center gap-4">
          <span>NGUYEN ANH TUAN - WAUP GLOBAL</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Engine: Gemini 3.1 Pro </span>
          <span>Status: All Systems Functional</span>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #334155;
        }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: #475569;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: #94a3b8;
        }
      `}</style>
      </div>
    </div>
  );
}
