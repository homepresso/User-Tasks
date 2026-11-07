import type { ConnectorDefinition } from '../registry'
import { awsS3Connector } from './aws-s3'

const regionOptions = awsS3Connector.fields.find((field) => field.key === 'region')?.options ?? []

export const awsMediaConnector: ConnectorDefinition = {
  key: 'aws_media',
  name: 'AWS Transcribe + Rekognition',
  description: 'Speech to text with Amazon Transcribe and image analysis (faces, labels, text, moderation) with Amazon Rekognition',
  category: 'ai',
  icon: 'Cloud',
  color: '#FF9900',
  docsUrl: 'https://docs.aws.amazon.com/transcribe/latest/dg/what-is.html',
  recommendedPermissions: {
    title: 'IAM permissions',
    items: [
      'transcribe:StartTranscriptionJob, transcribe:GetTranscriptionJob, transcribe:DeleteTranscriptionJob',
      'rekognition:DetectFaces, rekognition:DetectLabels, rekognition:DetectText, rekognition:DetectModerationLabels',
      's3:PutObject, s3:GetObject, s3:DeleteObject on the staging bucket',
    ],
    note: 'Media to transcribe is staged in the bucket under usertasks-media/ and deleted when the job ends.',
  },
  fields: [
    {
      key: 'region',
      label: 'AWS Region',
      type: 'select',
      required: true,
      options: regionOptions,
      defaultValue: 'us-east-1',
    },
    {
      key: 'bucket',
      label: 'Staging bucket',
      type: 'text',
      placeholder: 'my-transcribe-staging',
      required: true,
      validation: { type: 'aws_bucket' },
      helpText: 'An S3 bucket in the same region. Transcribe reads the media from it; each file is deleted after its job.',
    },
  ],
  credentialFields: [
    {
      key: 'access_key_id',
      label: 'Access Key ID',
      type: 'text',
      placeholder: 'AKIA...',
      required: true,
      helpText: 'AWS IAM → Users → your user → Security credentials → Create access key',
    },
    {
      key: 'secret_access_key',
      label: 'Secret Access Key',
      type: 'password',
      required: true,
      helpText: 'Shown once when the access key is created',
    },
    {
      key: 'session_token',
      label: 'Session token (optional)',
      type: 'password',
      helpText: 'Only for temporary credentials',
    },
  ],
  referenceTemplates: [],
  buildIntegrationConfig: (config, credentials) => {
    const region = String(config.region || 'us-east-1').trim()
    return {
      base_url: `https://transcribe.${region}.amazonaws.com`,
      auth_type: 'api_key',
      auth_config: {
        _executor: 'aws_media',
        access_key_id: credentials.access_key_id,
        secret_access_key: credentials.secret_access_key,
        ...(credentials.session_token ? { session_token: credentials.session_token } : {}),
        region,
        bucket: String(config.bucket ?? '').trim(),
      },
    }
  },
}
