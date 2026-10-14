const mongoose = require('mongoose');

const createConnectionError = (category, safeMessage, cause) => {
  const error = new Error(safeMessage, { cause });
  error.category = category;
  return error;
};

const getNestedErrors = (error, seen = new Set()) => {
  if (!error || typeof error !== 'object' || seen.has(error)) return [];
  seen.add(error);

  const nested = [error.cause, error.reason, ...(Array.isArray(error.errors) ? error.errors : [])];
  if (error.servers instanceof Map) {
    for (const server of error.servers.values()) nested.push(server.error);
  }
  return [error, ...nested.flatMap((item) => getNestedErrors(item, seen))];
};

const classifyConnectionError = (error) => {
  const errors = getNestedErrors(error);
  const codes = errors.map((item) => item.code);
  const syscalls = errors.map((item) => item.syscall);

  if (errors.some((item) => item.code === 18 || item.codeName === 'AuthenticationFailed')) {
    return {
      category: 'authentication failure',
      message: 'Verify the MongoDB database user, password, and authSource in the backend environment.',
    };
  }
  if (errors.some((item) => item.name === 'MongoParseError')) {
    return {
      category: 'invalid URI',
      message: 'Check that MONGO_URI is a valid mongodb:// or mongodb+srv:// URI.',
    };
  }
  if (syscalls.some((syscall) => syscall === 'querySrv' || syscall === 'queryTxt')) {
    return {
      category: 'DNS/SRV resolution failure',
      message: 'The MongoDB Atlas hostname could not be resolved. Check DNS/network access and confirm the cluster hostname in MongoDB Atlas.',
    };
  }
  if (codes.some((code) => ['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ENODATA'].includes(code))) {
    return {
      category: 'DNS resolution failure',
      message: 'The MongoDB hostname could not be resolved. Check DNS/network access and confirm the configured hostname.',
    };
  }
  if (codes.includes('ECONNREFUSED')) {
    const uri = process.env.MONGO_URI || '';
    const isLocal = /^mongodb:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(uri);
    return {
      category: isLocal ? 'local MongoDB connection refused' : 'MongoDB connection refused',
      message: isLocal
        ? 'The local MongoDB host refused the connection. Verify the MongoDB service is running and the URI port matches its configured port.'
        : 'The MongoDB host refused the connection. Check the configured host and whether the MongoDB service accepts connections.',
    };
  }
  if (errors.some((item) => item.name === 'MongooseServerSelectionError' || item.name === 'MongoServerSelectionError')
    || codes.some((code) => ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code))) {
    return {
      category: 'server selection timeout/network failure',
      message: 'MongoDB did not respond in time. Check cluster availability, outbound network access, and the Atlas IP access list.',
    };
  }
  if (errors.some((item) => ['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(item.code))) {
    return {
      category: 'TLS certificate failure',
      message: 'Check system time and the MongoDB TLS certificate/CA configuration.',
    };
  }
  return {
    category: 'MongoDB connection failure',
    message: 'Check the MongoDB URI, DNS/network access, cluster availability, and credentials.',
  };
};

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGO_URI?.trim();
  if (!uri) {
    throw createConnectionError(
      'missing environment variable',
      'MONGO_URI is required in backend/.env.'
    );
  }
  if (!/^mongodb(?:\+srv)?:\/\/\S+$/i.test(uri)) {
    throw createConnectionError(
      'invalid URI',
      'MONGO_URI must be a valid mongodb:// or mongodb+srv:// URI.'
    );
  }

  try {
    console.log('Attempting to connect to MongoDB...');
    mongoose.set('bufferCommands', false);

    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (error) => {
      const diagnosis = classifyConnectionError(error);
      console.error(`MongoDB connection error [${diagnosis.category}]. ${diagnosis.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.error('MongoDB connection disconnected.');
    });

    return conn;
  } catch (error) {
    const diagnosis = classifyConnectionError(error);
    console.error(`MongoDB connection failed [${diagnosis.category}]. ${diagnosis.message}`);
    throw createConnectionError(diagnosis.category, diagnosis.message, error);
  }
};

module.exports = connectDB;
module.exports.classifyConnectionError = classifyConnectionError;
