import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Download, RefreshCcw, Search } from 'lucide-react';
import { auditLogsApi } from '../services/api';
import Pagination from '../components/Pagination';
import LoadingSpinner from '../components/LoadingSpinner';

const DEFAULT_FILTERS = {
  actor: '',
  action: '',
  search: '',
  source: '',
  from: '',
  to: ''
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ru-RU');
};

const parseMeta = (meta) => (meta && typeof meta === 'object' ? meta : {});

const buildMetaPreview = (meta) => {
  const data = parseMeta(meta);
  const parts = [];
  if (data.source) parts.push(`source: ${data.source}`);
  if (data.bot_identifier) parts.push(`bot: ${data.bot_identifier}`);
  if (data.update_type) parts.push(`update: ${data.update_type}`);
  if (data.command) parts.push(`cmd: ${data.command}`);
  if (data.callback_data) parts.push(`cb: ${data.callback_data}`);
  if (data.username) parts.push(`@${data.username}`);
  if (data.tg_id) parts.push(`tg:${data.tg_id}`);
  if (data.text) parts.push(`text: ${String(data.text).slice(0, 120)}`);
  if (data.caption) parts.push(`caption: ${String(data.caption).slice(0, 120)}`);
  return parts.join(' | ');
};

const AuditLogsPage = () => {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    pages: 0
  });

  const requestParams = useMemo(() => {
    const params = {
      page: pagination.page,
      limit: pagination.limit
    };
    Object.entries(appliedFilters).forEach(([key, value]) => {
      const normalized = String(value || '').trim();
      if (normalized) params[key] = normalized;
    });
    return params;
  }, [appliedFilters, pagination.page, pagination.limit]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const response = await auditLogsApi.getLogs(requestParams);
      const payload = response?.data || {};
      setLogs(Array.isArray(payload.logs) ? payload.logs : []);
      setPagination((prev) => ({
        ...prev,
        total: Number(payload.total || 0),
        pages: Number(payload.pages || 0)
      }));
    } catch (error) {
      console.error('Load audit logs error:', error);
      toast.error('Ошибка загрузки логов');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [requestParams]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const applyFilters = () => {
    setPagination((prev) => ({ ...prev, page: 1 }));
    setAppliedFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const params = {
        ...requestParams,
        page: undefined,
        limit: 20000
      };

      const response = await auditLogsApi.downloadLogs(params);
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit_logs_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Логи скачаны');
    } catch (error) {
      console.error('Download audit logs error:', error);
      toast.error('Ошибка скачивания логов');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Аудит действий</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Детальные действия пользователей и апдейтов Telegram-бота</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadLogs}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <RefreshCcw className="w-4 h-4" />
              Обновить
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              {downloading ? 'Скачивание...' : 'Скачать CSV'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <input
            type="text"
            value={filters.actor}
            onChange={(e) => handleFilterChange('actor', e.target.value)}
            placeholder="actor: tg:..., support:..., user:..."
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={filters.action}
            onChange={(e) => handleFilterChange('action', e.target.value)}
            placeholder="action: bot_command, order_created..."
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            placeholder="Поиск по actor/action/meta"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={filters.source}
            onChange={(e) => handleFilterChange('source', e.target.value)}
            placeholder="source: telegram_bot"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={filters.from}
            onChange={(e) => handleFilterChange('from', e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(e) => handleFilterChange('to', e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={applyFilters}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
          >
            <Search className="w-4 h-4" />
            Применить
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Сбросить
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="p-8">
            <LoadingSpinner />
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[65vh]">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">Дата</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">Actor</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">Action</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">Подробности</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                        Логи не найдены
                      </td>
                    </tr>
                  )}
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-100 dark:border-gray-700/60">
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">{formatDate(log.created_at)}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-gray-700 dark:text-gray-300">{log.actor}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-blue-700 dark:text-blue-300 font-medium">{log.action}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 break-words">{buildMetaPreview(log.meta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={pagination.page}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              itemsPerPage={pagination.limit}
              onPageChange={(nextPage) => setPagination((prev) => ({ ...prev, page: nextPage }))}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default AuditLogsPage;
