import React from 'react';

// Skeleton loader component
const TableSkeleton = ({ columns, rows = 5 }) => {
  return (
    <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
      {/* Premium gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>
      
      {/* Desktop Skeleton */}
      <div className="hidden lg:block overflow-x-auto relative">
        <table className="min-w-full divide-y divide-gray-200/50 dark:divide-gray-700/50">
          <thead className="bg-gradient-to-r from-gray-50 via-gray-100 to-gray-50 dark:from-gray-800/80 dark:via-gray-800/60 dark:to-gray-800/80 relative">
            <tr>
              {columns.map((column, index) => (
                <th
                  key={index}
                  className="px-6 py-4 text-left"
                  style={{ width: column.width }}
                >
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4"></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white/50 dark:bg-gray-900/50 divide-y divide-gray-200/30 dark:divide-gray-700/30 relative">
            {[...Array(rows)].map((_, rowIndex) => (
              <tr key={rowIndex} className="animate-pulse">
                {columns.map((column, colIndex) => (
                  <td key={colIndex} className="px-6 py-4">
                    <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Skeleton */}
      <div className="lg:hidden divide-y divide-gray-200/30 dark:divide-gray-700/30 relative">
        {[...Array(rows)].map((_, index) => (
          <div key={index} className="p-5 space-y-3 animate-pulse">
            {columns.filter(col => !col.mobileHide).map((column, colIndex) => (
              <div key={colIndex} className="flex justify-between items-start py-1.5">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

const ResponsiveTable = ({
  columns,
  data,
  loading = false,
  emptyMessage = "Данные отсутствуют",
  className = "",
  rowClassName = null,
  skeletonRows = 5,
  compact = false,
}) => {
  if (loading) {
    return <TableSkeleton columns={columns} rows={skeletonRows} />;
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="text-center py-16 px-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800/50 dark:to-gray-700/50 mb-4">
          <svg className="w-8 h-8 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <p className="text-gray-500 dark:text-gray-500 font-medium">{emptyMessage}</p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden ${className}`}>
        {/* Compact Desktop Table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                {columns.map((column, index) => (
                  <th
                    key={index}
                    className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider whitespace-nowrap"
                    style={{ width: column.width }}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.map((row, rowIndex) => {
                const customRowClass = rowClassName ? rowClassName(row, rowIndex) : '';
                return (
                  <tr
                    key={rowIndex}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors duration-100 ${customRowClass}`}
                  >
                    {columns.map((column, colIndex) => (
                      <td key={colIndex} className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {column.render ? column.render(row, rowIndex) : row[column.key]}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Compact Mobile Cards */}
        <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-800">
          {data.map((row, index) => {
            const customRowClass = rowClassName ? rowClassName(row, index) : '';
            return (
              <div
                key={index}
                className={`px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors ${customRowClass}`}
              >
                <div className="space-y-1">
                  {columns.map((column, colIndex) => {
                    if (column.mobileHide) return null;
                    return (
                      <div key={colIndex} className="flex justify-between items-center">
                        <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mr-3 shrink-0">
                          {column.header}
                        </span>
                        <span className="text-xs text-gray-700 dark:text-gray-300 text-right">
                          {column.render ? column.render(row, index) : row[column.key]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden ${className}`}>
      {/* Premium gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>
      {/* Desktop Table */}
      <div className="hidden lg:block overflow-x-auto relative">
        <table className="orders-table min-w-full divide-y divide-gray-200/50 dark:divide-gray-700/50">
          <thead className="bg-gradient-to-r from-gray-50 via-gray-100 to-gray-50 dark:from-gray-800/80 dark:via-gray-800/60 dark:to-gray-800/80 relative">
            <tr>
              {columns.map((column, index) => {
                const headerText = typeof column.header === 'string' ? column.header.trim() : '';
                const headerPaddingClass = headerText === '№' || headerText === 'ID заявки' ? 'px-4' : 'px-2';

                return (
                  <th
                    key={index}
                    className={`${headerPaddingClass} py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap border-b-2 border-blue-500/10 dark:border-blue-400/10`}
                    style={{ width: column.width }}
                  >
                    <div className="flex items-center space-x-2">
                      <span>{column.header}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-white/50 dark:bg-gray-900/50 divide-y divide-gray-200/30 dark:divide-gray-700/30 relative">
            {data.map((row, rowIndex) => {
              const customRowClass = rowClassName ? rowClassName(row, rowIndex) : '';
              return (
                <tr
                  key={rowIndex}
                  className={`group hover:bg-gradient-to-r hover:from-blue-50/40 hover:to-indigo-50/40 dark:hover:from-blue-950/20 dark:hover:to-indigo-950/20 transition-all duration-200 ${customRowClass}`}
                >
                  {columns.map((column, colIndex) => (
                    <td key={colIndex} className="px-2 py-4 text-sm text-gray-900 dark:text-gray-200 whitespace-nowrap">
                      {column.render ? column.render(row, rowIndex) : row[column.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="lg:hidden divide-y divide-gray-200/30 dark:divide-gray-700/30 relative">
        {data.map((row, index) => {
          const customRowClass = rowClassName ? rowClassName(row, index) : '';
          return (
            <div
              key={index}
              className={`group p-5 hover:bg-gradient-to-br hover:from-blue-50/30 hover:to-indigo-50/30 dark:hover:from-blue-950/15 dark:hover:to-indigo-950/15 transition-all duration-200 rounded-xl mx-2 my-2 first:mt-0 last:mb-0 border border-transparent hover:border-blue-200/30 dark:hover:border-blue-700/20 ${customRowClass}`}
            >
              <div className="space-y-3">
                {columns.map((column, colIndex) => {
                  if (column.mobileHide) return null;

                  return (
                    <div key={colIndex} className="flex justify-between items-start py-1.5">
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-500 uppercase tracking-wide mr-3">
                        {column.header}:
                      </span>
                      <span className="text-sm text-gray-800 dark:text-gray-300 text-right font-medium">
                        {column.render ? column.render(row, index) : row[column.key]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ResponsiveTable;
