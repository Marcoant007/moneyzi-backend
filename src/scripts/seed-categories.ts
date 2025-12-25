import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const CATEGORIES = [
    "Educação",
    "Entretenimento",
    "Serviços",
    "Alimentação",
    "Lanche",
    "Jogos",
    "Saúde",
    "Moradia",
    "Outros",
    "Salário",
    "Transporte",
    "Assinatura",
    "Streaming",
    "Utilidades"
]

async function main() {
    console.log('Starting seed...')

    // Buscar todos os usuários
    const users = await prisma.user.findMany()
    console.log(`Found ${users.length} users`)

    for (const user of users) {
        console.log(`Processing user: ${user.name} (${user.id})`)
        let createdCount = 0

        for (const categoryName of CATEGORIES) {
            // Verificar se a categoria já existe para evitar duplicidade
            const existingCategory = await prisma.category.findFirst({
                where: {
                    userId: user.id,
                    name: {
                        equals: categoryName,
                        mode: 'insensitive' // Busca case insensitive
                    }
                }
            })

            if (!existingCategory) {
                await prisma.category.create({
                    data: {
                        name: categoryName,
                        userId: user.id
                    }
                })
                createdCount++
            }
        }
        console.log(`  - Created ${createdCount} new categories`)
    }

    console.log('Seed completed successfully')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
