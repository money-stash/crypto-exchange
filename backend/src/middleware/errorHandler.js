// обработка ошибок
const errorHandler = (err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    query: req.query,
    params: req.params,
    user: req.user?.id
  });

  // дефолтная ошибка
  let error = {
    status: 500,
    message: 'Internal server error'
  };

  // обрабатываем конкретные типы ошибок
  if (err.name === 'ValidationError') {
    error.status = 400;
    error.message = 'Validation error';
    error.details = err.message;
  } else if (err.name === 'UnauthorizedError' || err.message === 'jwt malformed') {
    error.status = 401;
    error.message = 'Unauthorized';
  } else if (err.code === 'ER_DUP_ENTRY') {
    error.status = 409;
    error.message = 'Duplicate entry';
  } else if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    error.status = 400;
    error.message = 'Referenced record not found';
  } else if (err.message && typeof err.message === 'string') {
    // кастомные ошибки приложения
    error.message = err.message;
    if (err.message.includes('not found')) error.status = 404;
    if (err.message.includes('access denied') || err.message.includes('permission')) error.status = 403;
    if (err.message.includes('invalid') || err.message.includes('required')) error.status = 400;
  }

  res.status(error.status).json({
    error: error.message,
    ...(error.details && { details: error.details }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// 404 страница
const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
};

// обертка для async функций
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler
};