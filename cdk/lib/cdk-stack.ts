import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Table
    const table = new dynamodb.Table(this, 'KilometerTrips', {
      tableName: 'kilometer-trips',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Lambda Function
    const tripFunction = new lambda.Function(this, 'TripFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    switch (event.httpMethod) {
      case 'GET':
        const scanResult = await docClient.send(new ScanCommand({
          TableName: 'kilometer-trips'
        }));
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(scanResult.Items || [])
        };

      case 'POST':
        const trip = JSON.parse(event.body);
        await docClient.send(new PutCommand({
          TableName: 'kilometer-trips',
          Item: trip
        }));
        return {
          statusCode: 201,
          headers,
          body: JSON.stringify({ success: true })
        };

      case 'DELETE':
        const { id } = JSON.parse(event.body);
        await docClient.send(new DeleteCommand({
          TableName: 'kilometer-trips',
          Key: { id }
        }));
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true })
        };

      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
      `),
      environment: {
        TABLE_NAME: table.tableName
      }
    });

    // Grant permissions
    table.grantReadWriteData(tripFunction);

    // API Gateway
    const api = new apigateway.RestApi(this, 'TripApi', {
      restApiName: 'Kilometer Trip Service',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type']
      }
    });

    const trips = api.root.addResource('trips');
    trips.addMethod('GET', new apigateway.LambdaIntegration(tripFunction));
    trips.addMethod('POST', new apigateway.LambdaIntegration(tripFunction));
    trips.addMethod('DELETE', new apigateway.LambdaIntegration(tripFunction));

    // Output API URL
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL'
    });
  }
}
