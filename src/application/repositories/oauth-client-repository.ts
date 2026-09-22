export interface OAuthClient {
    id: string
    clientName: string | null
    redirectUris: string[]
    tokenEndpointAuthMethod: string
    grantTypes: string[]
    responseTypes: string[]
}

export interface OAuthClientRepository {
    create(data: { clientName: string | null; redirectUris: string[] }): Promise<OAuthClient>
    findById(id: string): Promise<OAuthClient | null>
}
