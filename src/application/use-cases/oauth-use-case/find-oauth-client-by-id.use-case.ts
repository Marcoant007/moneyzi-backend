import type { OAuthClientRepository } from '@/application/repositories/oauth-client-repository'

export class FindOAuthClientByIdUseCase {
    constructor(private readonly oauthClientRepository: OAuthClientRepository) {}

    async execute(clientId: string) {
        return this.oauthClientRepository.findById(clientId)
    }
}
