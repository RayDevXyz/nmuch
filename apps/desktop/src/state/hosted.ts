/** Set when running as a hosted web app (bw-server): the signed-in owner's name. */
let user: string | null = null
export const setHostedUser = (u: string) => (user = u)
export const hostedUser = () => user
