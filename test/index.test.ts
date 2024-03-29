import { Message, NPC} from '../src';
import {Cancelable} from "@neutronstarer/cancelable";

describe('index', () => {
    let npc0: NPC
    let npc1: NPC
    npc0 = new NPC()
    npc1 = new NPC()
    npc0.connect(async (message: Message) => {
        console.log("0_SEND" + JSON.stringify(message))
        await npc1?.receive(message)
    });
    npc1.connect(async (message: Message) => {
        console.log("1_SEND" + JSON.stringify(message))
        await npc0?.receive(message)
    });
    config(npc0)
    config(npc1)
    it('deliver', async () => {
        const param = "/path"
        const r = await npc0?.deliver("download", param, 0)
        expect(r).toEqual("Did download to " + param)
    })
    it('timeout', async ()=>{
        try {
            const param = "/path"
            const r = await npc0?.deliver("download", param, 1000)
            expect(r).toEqual("Did download to " + param)
        } catch (e) {
            expect(e).toEqual("timedout")
        }
    })
    it('cancel', async ()=>{
        try {
            const param = "/path"
            const cancelable = new Cancelable()
            setTimeout(()=>{
                cancelable.cancel()
            }, 1000)
            const r = await npc0?.deliver("download", param, 0, cancelable)
            expect(r).toEqual("Did download to " + param)
        } catch (e) {
            expect(e).toEqual("cancelled")
        }
    })
})

function config(npc: NPC) {
    npc.on("download", async (param, cancelable, notify) => {
        let resolve: (value: any)=>void
        let reject: (value?: any)=>void
        let i = 0
        let timer: any = undefined
        const promise = new Promise<any>((rs, rj)=>{
            resolve = rs
            reject = rj
        })
        timer = setInterval(async ()=>{
            i++
            if (i<=3){
                await notify("progress="+i+"/3")
                return
            }
            resolve("Did download to " + param)
            if (timer != undefined){
                clearInterval(timer)
            }
        }, 1000)
        cancelable.whenCancel(async ()=>{
            reject("cancelled")
            if (timer != undefined){
                clearInterval(timer)
            }
        })
        return promise
    })
}
