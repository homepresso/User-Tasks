import type { ConnectorDefinition } from '../registry'

export const awsS3Connector: ConnectorDefinition = {
  key: 'aws_s3',
  name: 'AWS S3',
  description: 'Upload, download, and manage files in Amazon S3 buckets',
  category: 'cloud',
  icon: 'Cloud',
  color: '#FF9900',
  docsUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/API',
  fields: [
    {
      key: 'region',
      label: 'AWS Region',
      type: 'select',
      required: true,
      options: [
        // US
        { value: 'us-east-1', label: 'US East (N. Virginia)' },
        { value: 'us-east-2', label: 'US East (Ohio)' },
        { value: 'us-west-1', label: 'US West (N. California)' },
        { value: 'us-west-2', label: 'US West (Oregon)' },
        // Canada
        { value: 'ca-central-1', label: 'Canada (Central)' },
        { value: 'ca-west-1', label: 'Canada West (Calgary)' },
        // Europe
        { value: 'eu-west-1', label: 'EU (Ireland)' },
        { value: 'eu-west-2', label: 'EU (London)' },
        { value: 'eu-west-3', label: 'EU (Paris)' },
        { value: 'eu-central-1', label: 'EU (Frankfurt)' },
        { value: 'eu-central-2', label: 'EU (Zurich)' },
        { value: 'eu-north-1', label: 'EU (Stockholm)' },
        { value: 'eu-south-1', label: 'EU (Milan)' },
        { value: 'eu-south-2', label: 'EU (Spain)' },
        // Asia Pacific
        { value: 'ap-east-1', label: 'Asia Pacific (Hong Kong)' },
        { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
        { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
        { value: 'ap-southeast-3', label: 'Asia Pacific (Jakarta)' },
        { value: 'ap-southeast-4', label: 'Asia Pacific (Melbourne)' },
        { value: 'ap-southeast-5', label: 'Asia Pacific (Malaysia)' },
        { value: 'ap-southeast-7', label: 'Asia Pacific (Thailand)' },
        { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
        { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
        { value: 'ap-northeast-3', label: 'Asia Pacific (Osaka)' },
        { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
        { value: 'ap-south-2', label: 'Asia Pacific (Hyderabad)' },
        // South America
        { value: 'sa-east-1', label: 'South America (São Paulo)' },
        // Middle East
        { value: 'me-south-1', label: 'Middle East (Bahrain)' },
        { value: 'me-central-1', label: 'Middle East (UAE)' },
        // Africa
        { value: 'af-south-1', label: 'Africa (Cape Town)' },
        // Israel
        { value: 'il-central-1', label: 'Israel (Tel Aviv)' },
        // Mexico
        { value: 'mx-central-1', label: 'Mexico (Central)' },
      ],
      defaultValue: 'us-east-1',
    },
    {
      key: 'bucket',
      label: 'Default Bucket',
      type: 'text',
      placeholder: 'my-bucket-name',
      required: true,
      validation: { type: 'aws_bucket' },
      helpText: 'Default S3 bucket name',
    },
  ],
  credentialFields: [
    {
      key: 'access_key_id',
      label: 'Access Key ID',
      type: 'text',
      placeholder: 'AKIA...',
      required: true,
      helpText: 'IAM Access Key ID with S3 permissions',
    },
    {
      key: 'secret_access_key',
      label: 'Secret Access Key',
      type: 'password',
      placeholder: 'wJalrXUtnFEMI...',
      required: true,
      helpText: 'IAM Secret Access Key',
    },
  ],
  referenceTemplates: [
    {
      key: 'put_object',
      name: 'Upload Object',
      description: 'Upload a file or data to an S3 bucket',
      method: 'PUT',
      pathTemplate: '/{{key}}',
      bodyTemplate: '{{content}}',
      inputs: [
        { name: 'bucket', type: 'string', required: false, description: 'Bucket name (uses default if empty)' },
        { name: 'key', type: 'string', required: true, description: 'Object key / file path (e.g. uploads/file.pdf)' },
        { name: 'content', type: 'string', required: true, description: 'File content or base64 data' },
        { name: 'content_type', type: 'string', required: false, description: 'MIME type', defaultValue: 'application/octet-stream' },
      ],
      outputs: [
        { name: 'etag', type: 'string' },
        { name: 'url', type: 'string' },
      ],
    },
    {
      key: 'get_object',
      name: 'Download Object',
      description: 'Download a file from an S3 bucket',
      method: 'GET',
      pathTemplate: '/{{key}}',
      inputs: [
        { name: 'bucket', type: 'string', required: false, description: 'Bucket name' },
        { name: 'key', type: 'string', required: true, description: 'Object key / file path' },
      ],
      outputs: [
        { name: 'body', type: 'string' },
        { name: 'content_type', type: 'string' },
        { name: 'content_length', type: 'number' },
      ],
    },
    {
      key: 'list_objects',
      name: 'List Objects',
      description: 'List files in an S3 bucket with optional prefix filter',
      method: 'GET',
      pathTemplate: '/?list-type=2&prefix={{prefix}}&max-keys={{max_keys}}',
      inputs: [
        { name: 'bucket', type: 'string', required: false, description: 'Bucket name' },
        { name: 'prefix', type: 'string', required: false, description: 'Filter by key prefix (folder path)' },
        { name: 'max_keys', type: 'number', required: false, description: 'Max results', defaultValue: '100' },
      ],
      outputs: [
        { name: 'contents', type: 'array' },
        { name: 'key_count', type: 'number' },
        { name: 'is_truncated', type: 'boolean' },
      ],
    },
    {
      key: 'delete_object',
      name: 'Delete Object',
      description: 'Delete a file from an S3 bucket',
      method: 'DELETE',
      pathTemplate: '/{{key}}',
      inputs: [
        { name: 'bucket', type: 'string', required: false, description: 'Bucket name' },
        { name: 'key', type: 'string', required: true, description: 'Object key / file path to delete' },
      ],
      outputs: [
        { name: 'status', type: 'number' },
      ],
    },
    {
      key: 'head_object',
      name: 'Check Object Exists',
      description: 'Check if an object exists and get its metadata (size, content type, last modified)',
      method: 'HEAD',
      pathTemplate: '/{{key}}',
      inputs: [
        { name: 'bucket', type: 'string', required: false, description: 'Bucket name' },
        { name: 'key', type: 'string', required: true, description: 'Object key / file path' },
      ],
      outputs: [
        { name: 'exists', type: 'boolean' },
        { name: 'content_type', type: 'string' },
        { name: 'content_length', type: 'number' },
        { name: 'last_modified', type: 'string' },
        { name: 'etag', type: 'string' },
      ],
    },
    {
      key: 'copy_object',
      name: 'Copy Object',
      description: 'Copy an object within S3 (same or different bucket)',
      method: 'PUT',
      pathTemplate: '/{{destination_key}}',
      headers: { 'x-amz-copy-source': '/{{source_bucket}}/{{source_key}}' },
      inputs: [
        { name: 'bucket', type: 'string', required: false, description: 'Destination bucket (uses default if empty)' },
        { name: 'destination_key', type: 'string', required: true, description: 'Destination object key' },
        { name: 'source_bucket', type: 'string', required: false, description: 'Source bucket (uses default if empty)' },
        { name: 'source_key', type: 'string', required: true, description: 'Source object key to copy from' },
      ],
      outputs: [
        { name: 'etag', type: 'string' },
        { name: 'last_modified', type: 'string' },
      ],
    },
  ],
  buildIntegrationConfig: (config, credentials) => ({
    // base_url used as fallback identifier — the executor builds virtual-hosted-style URLs
    base_url: `https://${config.bucket}.s3.${config.region || 'us-east-1'}.amazonaws.com`,
    auth_type: 'api_key',
    auth_config: {
      _executor: 'aws_s3',
      access_key_id: credentials.access_key_id,
      secret_access_key: credentials.secret_access_key,
      region: config.region || 'us-east-1',
      bucket: config.bucket,
    },
  }),
}
