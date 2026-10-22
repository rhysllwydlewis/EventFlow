/**
 * EventFlow API Documentation
 * OpenAPI 3.0 Specification
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EventFlow API',
      version: '16.3.9',
      description:
        'Comprehensive event services marketplace API - A production-ready platform for connecting event service suppliers with customers',
      contact: {
        name: 'EventFlow Support',
        email: 'support@eventflow.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
      {
        url: 'https://api.eventflow.com',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'token',
          description: 'JWT token stored in HTTP-only cookie',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'usr_abc123' },
            name: { type: 'string', example: 'John Doe' },
            email: { type: 'string', format: 'email', example: 'john@example.com' },
            role: { type: 'string', enum: ['customer', 'supplier', 'admin'], example: 'customer' },
            verified: { type: 'boolean', example: true },
            isPro: { type: 'boolean', example: false },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Supplier: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'sup_xyz789' },
            name: { type: 'string', example: 'Elite Photography' },
            category: { type: 'string', example: 'Photography' },
            location: { type: 'string', example: 'New York, NY' },
            price_display: { type: 'string', example: '$$' },
            description_short: { type: 'string', example: 'Professional event photography' },
            description_long: { type: 'string', example: 'Full description...' },
            amenities: { type: 'array', items: { type: 'string' }, example: ['WiFi', 'Parking'] },
            maxGuests: { type: 'integer', example: 200 },
            averageRating: { type: 'number', format: 'float', example: 4.5 },
            reviewCount: { type: 'integer', example: 25 },
            approved: { type: 'boolean', example: true },
            isPro: { type: 'boolean', example: true },
            verified: { type: 'boolean', example: true },
            photosGallery: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string', format: 'uri' },
                  thumbnail: { type: 'string', format: 'uri' },
                  approved: { type: 'boolean' },
                  uploadedAt: { type: 'integer' },
                },
              },
            },
          },
        },
        Review: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'rev_abc123' },
            supplierId: { type: 'string', example: 'sup_xyz789' },
            userId: { type: 'string', example: 'usr_abc123' },
            userName: { type: 'string', example: 'John Doe' },
            rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
            comment: { type: 'string', example: 'Excellent service!' },
            eventType: { type: 'string', example: 'Wedding' },
            eventDate: { type: 'string', format: 'date', example: '2024-06-15' },
            approved: { type: 'boolean', example: true },
            verified: { type: 'boolean', example: true },
            helpful: { type: 'integer', example: 10 },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Package: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'pkg_abc123' },
            supplierId: { type: 'string', example: 'sup_xyz789' },
            title: { type: 'string', example: 'Wedding Package' },
            description: { type: 'string', example: 'Complete wedding photography package' },
            price: { type: 'string', example: '£2,500' },
            price_display: {
              type: 'string',
              example: '£2,500',
              description:
                'The price as shown (free text, up to 60 characters). Holds the same text as price once saved; readers use price_display first, then price.',
            },
            image: { type: 'string', format: 'uri' },
            approved: { type: 'boolean', example: true },
            featured: { type: 'boolean', example: false },
            gallery: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string', format: 'uri' },
                  thumbnail: { type: 'string', format: 'uri' },
                  approved: { type: 'boolean' },
                },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Error message' },
            details: { type: 'string', example: 'Detailed error information' },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Operation completed successfully' },
          },
        },
      },
    },
    tags: [
      { name: 'Authentication', description: 'User authentication and registration' },
      { name: 'Search', description: 'Advanced search and filtering' },
      { name: 'Discovery', description: 'Trending, new, and recommended content' },
      { name: 'Reviews', description: 'Supplier reviews and ratings' },
      { name: 'Photos', description: 'Photo upload and management' },
      { name: 'Suppliers', description: 'Supplier management' },
      { name: 'Packages', description: 'Package management' },
      { name: 'Admin', description: 'Admin-only endpoints' },
      { name: 'User', description: 'User profile and preferences' },
    ],
  },
  apis: ['./server.js', './routes/*.js', './docs/*.js'], // paths to files with API annotations
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
