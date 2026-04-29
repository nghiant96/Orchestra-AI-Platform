import { NavLink } from 'react-router-dom';
import { Terminal, Activity, Settings, Search, RefreshCw, FolderTree, ChevronDown, BarChart3 } from 'lucide-react';
import { cn } from '../utils/cn';

interface NavbarProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  fetchJobs: () => void;
  loading: boolean;
  allowedWorkdirs: string[];
  currentProject: string;
  onProjectChange: (path: string) => void;
}

export const Navbar = ({
  searchTerm,
  setSearchTerm,
  fetchJobs,
  loading,
  allowedWorkdirs,
  currentProject,
  onProjectChange
}: NavbarProps) => {
  return (
    <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex justify-between items-center">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-600 to-violet-700 p-2 rounded-xl shadow-lg shadow-indigo-200">
              <Terminal className="text-white" size={22} />
            </div>
            <div className="hidden lg:block">
              <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent leading-none">ORCHESTRA-AI</h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Platform</p>
            </div>
          </div>

          {/* Project Selector */}
          <div className="relative group">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-200 transition-all">
              <FolderTree size={14} className="text-indigo-500" />
              <div className="max-w-[150px] truncate text-xs font-black uppercase tracking-tight text-slate-700">
                {currentProject.split('/').pop() || 'Select Project'}
              </div>
              <ChevronDown size={12} className="text-slate-400" />
            </div>
            
            <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] overflow-hidden">
              <div className="p-2 max-h-64 overflow-y-auto custom-scrollbar">
                {allowedWorkdirs.map(path => (
                  <div
                    key={path}
                    onClick={() => onProjectChange(path)}
                    className={cn(
                      "px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest cursor-pointer transition-all mb-1 last:mb-0",
                      currentProject === path ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <p className="truncate">{path.split('/').pop()}</p>
                    <p className="text-[8px] opacity-50 truncate font-mono mt-0.5">{path}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <NavLink
              to="/"
              className={({ isActive }) => cn(
                "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                isActive ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <Activity size={14} />
              Activity
            </NavLink>
            <NavLink
              to="/config"
              className={({ isActive }) => cn(
                "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                isActive ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <Settings size={14} />
              Config
            </NavLink>
            <NavLink
              to="/analytics"
              className={({ isActive }) => cn(
                "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                isActive ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <BarChart3 size={14} />
              Analytics
            </NavLink>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden xl:flex items-center bg-slate-100 rounded-lg px-3 py-1.5 border border-slate-200 gap-2">
            <Search size={14} className="text-slate-400" />
            <input
              type="text"
              placeholder="Search engine..."
              className="bg-transparent text-xs outline-none w-32 text-slate-600 font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            onClick={() => fetchJobs()}
            className="p-2 text-slate-400 hover:text-indigo-600 transition-colors bg-slate-50 rounded-lg border border-slate-200"
            aria-label="Refresh jobs"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 border-2 border-white shadow-sm cursor-pointer" />
        </div>
      </div>
    </nav>
  );
};
